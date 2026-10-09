import SwiftUI

struct IslandReplyBox: View {
    @ObservedObject var model: IslandModel
    let activity: LiveActivity
    @FocusState private var editorFocused: Bool

    private var color: Color { model.display.color(for: activity.state) }
    private var canReply: Bool { activity.replyMode == "card" }
    private var isSending: Bool { model.sending.contains(activity.id) }
    private var hasDraft: Bool { !(model.drafts[activity.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var isActive: Bool { model.running.contains { $0.id == activity.id } }
    private var draft: Binding<String> {
        Binding(get: { model.drafts[activity.id] ?? "" }, set: { model.drafts[activity.id] = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            titleBar
            if let question = activity.question, !question.isEmpty {
                questionView(question)
            } else if model.display.showActivity, let detail = activity.activity ?? activity.stage {
                Text(detail).font(.system(size: model.display.fontSize)).foregroundStyle(.secondary).lineLimit(3)
            }
            if canReply { composer }
            else { externalNotice }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.25), lineWidth: 1))
        .onAppear { focusExplicitSelection() }
        .onChange(of: model.selectedId) { _, _ in focusExplicitSelection() }
        .onChange(of: activity.id) { _, _ in focusExplicitSelection() }
        .onChange(of: editorFocused) { _, value in model.inputFocusChanged?(value) }
        .onDisappear { if editorFocused { model.inputFocusChanged?(false) } }
        .onExitCommand { close() }
    }

    private var titleBar: some View {
        HStack(alignment: .center, spacing: 9) {
            ActivityPet(model: model, activity: activity)
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.title).font(.system(size: model.display.fontSize, weight: .semibold)).lineLimit(1)
                Text(isActive ? activity.stateLabel : "Execução encerrada")
                    .font(.system(size: max(8, model.display.fontSize - 1), weight: .medium)).foregroundStyle(color)
            }
            Spacer(minLength: 0)
            ActivityProfileBadge(model: model, activity: activity, maximumWidth: 100)
            Button { model.openActivity(activity) } label: { Image(systemName: "arrow.up.forward") }
                .help("Abrir conversa completa")
                .accessibilityLabel("Abrir conversa completa de \(activity.title)")
            Button(action: close) { Image(systemName: "xmark") }
                .help("Fechar resposta · Esc")
                .accessibilityLabel("Fechar caixa de resposta")
        }
        .buttonStyle(IslandIconButtonStyle())
    }

    private func questionView(_ question: String) -> some View {
        ScrollView {
            Text(question)
                .font(.system(size: model.display.fontSize + 1))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(7)
        }
        .frame(maxHeight: min(100, max(28, model.display.maxHeight - 230)))
        .background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel("Pergunta do agente")
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topLeading) {
                if (model.drafts[activity.id] ?? "").isEmpty {
                    Text(activity.state == "waiting" ? "Sua resposta…" : "Envie uma orientação ao agente…")
                        .font(.system(size: model.display.fontSize + 1)).foregroundStyle(.secondary)
                        .padding(.horizontal, 7).padding(.top, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: draft)
                    .font(.system(size: model.display.fontSize + 1))
                    .scrollContentBackground(.hidden)
                    .padding(3)
                    .focused($editorFocused)
                    .onKeyPress(.return, phases: .down) { press in
                        guard press.modifiers.contains(.command) else { return .ignored }
                        send()
                        return .handled
                    }
                    .accessibilityLabel(activity.state == "waiting" ? "Resposta para o agente" : "Orientação para o agente")
            }
            .frame(height: 40)
            .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(editorFocused ? color.opacity(0.65) : Color.white.opacity(0.10), lineWidth: 1))
            HStack(spacing: 9) {
                Text(isSending ? "Enviando…" : "Próxima chamada · ⌘ Enter")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
                    .help("Mensagens durante a execução são entregues na próxima chamada do agente.")
                Spacer()
                Button(action: send) {
                    HStack(spacing: 5) {
                        if isSending { ProgressView().controlSize(.mini) }
                        else { Image(systemName: model.replyErrors[activity.id] == nil ? "arrow.up" : "arrow.clockwise") }
                        Text(model.replyErrors[activity.id] == nil ? "Enviar" : "Tentar novamente")
                    }
                    .font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 11).frame(height: 23)
                    .background(color.opacity(hasDraft && !isSending && isActive ? 0.25 : 0.08), in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!hasDraft || isSending || !isActive)
                .opacity(hasDraft && !isSending && isActive ? 1 : 0.45)
                .help("Enviar mensagem · ⌘ Enter")
                .accessibilityLabel(model.replyErrors[activity.id] == nil ? "Enviar resposta ao agente" : "Tentar enviar novamente")
            }
            if let error = model.replyErrors[activity.id] {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.system(size: 10)).foregroundStyle(model.display.color(for: "error"))
                    .fixedSize(horizontal: false, vertical: true)
            } else if let notice = model.replyNotices[activity.id] {
                Label(notice, systemImage: "checkmark.circle")
                    .font(.system(size: 10)).foregroundStyle(model.display.color(for: "complete"))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !isActive {
                Text("Seu rascunho foi preservado. Abra o card para continuar a conversa.")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button { model.openActivity(activity) } label: { Label("Abrir card", systemImage: "arrow.up.forward") }
                    .buttonStyle(InputActionStyle(color: color))
                    .accessibilityLabel("Abrir card para continuar a conversa")
            }
        }
    }

    private var externalNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Responda no aplicativo de origem")
                .font(.system(size: model.display.fontSize, weight: .medium))
            Text("Esta execução foi iniciada fora do Mega Brain.")
                .font(.system(size: max(8, model.display.fontSize - 1))).foregroundStyle(.secondary)
            Button { model.openActivity(activity) } label: {
                Label("Abrir conversa", systemImage: "arrow.up.forward")
            }
            .buttonStyle(InputActionStyle(color: color))
            .accessibilityLabel("Abrir conversa no aplicativo de origem")
        }
    }

    private func focusExplicitSelection() {
        editorFocused = canReply && model.selectedId == activity.id
    }

    private func send() {
        guard hasDraft && !isSending && isActive else { return }
        model.sendReply(activity)
    }

    private func close() {
        editorFocused = false
        model.closeReply()
    }
}
