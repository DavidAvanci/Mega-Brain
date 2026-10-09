import AppKit
import SwiftUI

struct ActivityPet: View {
    @ObservedObject var model: IslandModel
    var activity: LiveActivity?
    var maximumSize: CGFloat = 40

    var body: some View {
        PixelPet(
            color: model.display.color(for: activity?.state ?? "idle"),
            state: activity?.state ?? "idle",
            agent: model.petAgent(activity?.agent ?? "codex"),
            size: min(maximumSize, model.display.petSize),
            animations: model.display.animations,
            speed: model.display.animationSpeed
        )
        .accessibilityLabel("Mascote: \(activity?.stateLabel ?? "Pronto")")
    }
}

func codexProfileColor(_ hex: String?) -> Color {
    let value = UInt32((hex ?? "#64B8FF").trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x64B8FF
    return Color(red: Double((value >> 16) & 255) / 255,
                 green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
}

struct ActivityProfileBadge: View {
    @ObservedObject var model: IslandModel
    let activity: LiveActivity
    var maximumWidth: CGFloat = 110
    var includeName = true

    private var profile: CodexProfile? { model.profiles.first { $0.id == activity.codexProfileId } }
    private var name: String? { activity.codexProfileName ?? profile?.name }

    var body: some View {
        if model.display.showProfileBadge, let name {
            HStack(spacing: 4) {
                Circle().fill(codexProfileColor(activity.codexProfileColor ?? profile?.color)).frame(width: 5, height: 5)
                if includeName {
                    Text(name).font(.system(size: 8, weight: .medium)).lineLimit(1)
                        .foregroundStyle(Color.white.opacity(0.58))
                }
            }
            .frame(maxWidth: maximumWidth, alignment: .leading)
            .fixedSize(horizontal: true, vertical: true)
            .help("Perfil Codex: \(name)")
            .accessibilityLabel("Perfil Codex: \(name)")
        }
    }
}

struct IslandHeader: View {
    @ObservedObject var model: IslandModel
    let progress: CGFloat

    private var detailed: Bool { model.display.style == "detailed" }
    private var description: String { model.connectionError ?? model.statusText }

    var body: some View {
        GeometryReader { geometry in
            let wing = max(0, (geometry.size.width - hardwareNotchWidth) / 2)
            HStack(spacing: 0) {
                HStack(spacing: 7) {
                    ActivityPet(model: model, activity: model.primary, maximumSize: 30)
                    headerTitle
                }
                .padding(.leading, 15)
                .frame(width: wing, alignment: .leading)
                .clipped()

                Color.clear.frame(width: hardwareNotchWidth)

                HStack(spacing: 2) {
                    Text("\(model.running.count)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(model.accent)
                        .help(model.running.count == 1 ? "1 agente ativo" : "\(model.running.count) agentes ativos")
                        .accessibilityLabel("\(model.running.count) agentes ativos")
                    Button(action: model.toggleSound) {
                        Image(systemName: model.soundEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    }
                    .help(model.soundEnabled ? "Silenciar sons" : "Ativar sons")
                    .accessibilityLabel(model.soundEnabled ? "Silenciar sons da ilha" : "Ativar sons da ilha")
                    Button { model.openMain(target: "settings") } label: { Image(systemName: "gearshape.fill") }
                        .help("Configurações da ilha dinâmica")
                        .accessibilityLabel("Abrir configurações da ilha dinâmica")
                }
                .buttonStyle(IslandIconButtonStyle())
                .padding(.trailing, 10)
                .frame(width: wing, alignment: .trailing)
                .clipped()
            }
            .frame(width: geometry.size.width, height: compactHeight)
        }
        .frame(height: compactHeight)
    }

    private var headerTitle: some View {
        VStack(alignment: .leading, spacing: 1) {
            if detailed || progress > 0.3 {
                Text(model.primary?.title ?? "Mega Brain")
                    .font(.system(size: model.display.fontSize, weight: .semibold))
                    .lineLimit(1)
            }
            HStack(spacing: 4) {
                if let primary = model.primary { ActivityProfileBadge(model: model, activity: primary, includeName: false) }
                Text(description)
                    .font(.system(size: max(8, model.display.fontSize - 2), weight: .medium))
                    .foregroundStyle(model.connectionError == nil ? model.accent : .orange)
                    .lineLimit(1)
            }
        }
        .help(model.primary.map { "\($0.title) · \(description)" } ?? description)
    }
}

struct IslandIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(configuration.isPressed ? .white : Color.white.opacity(0.65))
            .frame(width: 24, height: 24)
            .background(configuration.isPressed ? Color.white.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 7))
    }
}

struct AgentExecutionCard: View {
    @ObservedObject var model: IslandModel
    let activity: LiveActivity

    private var color: Color { model.display.color(for: activity.state) }
    private var detail: String {
        if model.display.showActivity { return activity.activity ?? activity.stage ?? activity.project ?? activity.stateLabel }
        return activity.stateLabel
    }

    var body: some View {
        HStack(spacing: 9) {
            ActivityPet(model: model, activity: activity, maximumSize: 24)
            Button { model.select(activity) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(activity.title).font(.system(size: model.display.fontSize, weight: .semibold)).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ActivityProfileBadge(model: model, activity: activity)
                    }
                    Text(detail).font(.system(size: max(8, model.display.fontSize - 2)))
                        .foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(activity.replyMode == "card" ? "Conversar com o agente" : "Ver atividade do agente")
            .accessibilityLabel("\(activity.title), \(activity.stateLabel)")
            if activity.total > 0 {
                Text("\(activity.checked)/\(activity.total)")
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                    .help("\(activity.checked) de \(activity.total) itens concluídos")
            }
            if activity.replyMode == "card" || activity.state == "waiting" {
                Button { model.select(activity) } label: {
                    Image(systemName: activity.state == "waiting" ? "bubble.left.fill" : "bubble.left")
                        .foregroundStyle(activity.state == "waiting" ? color : Color.white.opacity(0.55))
                }
                .buttonStyle(IslandIconButtonStyle())
                .help(activity.state == "waiting" ? "Responder ao agente" : "Conversar com o agente")
                .accessibilityLabel("Conversar com o agente de \(activity.title)")
            }
            Button { model.openActivity(activity) } label: { Image(systemName: "arrow.up.forward") }
                .buttonStyle(IslandIconButtonStyle())
                .help("Abrir \(activity.title)")
                .accessibilityLabel("Abrir \(activity.title)")
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(minHeight: model.display.completionHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(activity.state == "waiting" ? 0.085 : 0.045), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(activity.state == "waiting" ? 0.32 : 0.10), lineWidth: 1))
    }
}

struct CompactAgentRow: View {
    @ObservedObject var model: IslandModel
    let activities: [LiveActivity]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(activities) { activity in
                    Button { model.select(activity) } label: {
                        HStack(spacing: 6) {
                            ActivityPet(model: model, activity: activity, maximumSize: 19)
                            Text(activity.title).font(.system(size: 9, weight: .medium)).lineLimit(1)
                                .frame(maxWidth: 130, alignment: .leading)
                            ActivityProfileBadge(model: model, activity: activity, maximumWidth: 65)
                            Circle().fill(model.display.color(for: activity.state)).frame(width: 4, height: 4)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .help("\(activity.title) · \(activity.stateLabel)")
                    .accessibilityLabel("Selecionar \(activity.title), \(activity.stateLabel)")
                }
            }
        }
        .scrollIndicators(.hidden)
        .frame(height: 32)
    }
}

struct InputActionStyle: ButtonStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 29)
            .background(color.opacity(configuration.isPressed ? 0.35 : 0.18), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct IslandProfileMenu: View {
    @ObservedObject var model: IslandModel

    var body: some View {
        Menu {
            ForEach(model.profiles) { profile in
                Toggle(isOn: Binding(
                    get: { !model.display.hiddenCodexProfileIds.contains(profile.id) },
                    set: { model.setProfileVisible(profile.id, visible: $0) }
                )) {
                    Label {
                        Text(profile.name + (profile.id == model.snapshot.activeCodexProfileId ? " · padrão" : ""))
                    } icon: { Circle().fill(codexProfileColor(profile.color)) }
                }
                .disabled(model.updatingProfiles)
            }
            Divider()
            Button("Mostrar todos os perfis", action: model.showAllProfiles)
                .disabled(model.updatingProfiles || model.display.hiddenCodexProfileIds.isEmpty)
            Button { model.openMain(target: "settings") } label: {
                Label("Configurar perfis no Mega Brain", systemImage: "gearshape")
            }
        } label: {
            Label("Perfis", systemImage: "line.3.horizontal.decrease")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.60))
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("Escolher quais perfis Codex aparecem na ilha")
        .accessibilityLabel("Escolher perfis Codex visíveis na ilha dinâmica")
    }
}

struct ExpandedContent: View {
    @ObservedObject var model: IslandModel

    var body: some View {
        VStack(spacing: 7) {
            if !model.profiles.isEmpty { profilesToolbar }
            if let focused = model.focusedActivity {
                ScrollView {
                    IslandReplyBox(model: model, activity: focused)
                    if !model.display.compactOthers { agentRows(model.running.filter { $0.id != focused.id }) }
                }
                .scrollIndicators(.hidden)
                if model.display.compactOthers {
                    let others = model.running.filter { $0.id != focused.id }
                    if !others.isEmpty { CompactAgentRow(model: model, activities: others) }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 9) {
                        if model.running.isEmpty { emptyState }
                        else { agentRows(model.running) }
                        if !model.recent.isEmpty {
                            Text("RECENTES").font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary).padding(.top, 3)
                            agentRows(model.recent)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var profilesToolbar: some View {
        HStack(spacing: 6) {
            Text(model.running.count == 1 ? "1 agente ativo" : "\(model.running.count) agentes ativos")
                .font(.system(size: 8, weight: .medium)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let error = model.profileSettingsError {
                Image(systemName: "exclamationmark.circle").font(.system(size: 10)).foregroundStyle(.orange)
                    .help(error).accessibilityLabel(error)
            }
            IslandProfileMenu(model: model)
        }
        .frame(height: 16)
        .padding(.horizontal, 2)
    }

    private func agentRows(_ activities: [LiveActivity]) -> some View {
        LazyVStack(spacing: 6) {
            ForEach(activities) { activity in AgentExecutionCard(model: model, activity: activity) }
        }
    }

    private var emptyState: some View {
        Button { model.openMain() } label: {
            HStack(spacing: 9) {
                ActivityPet(model: model, activity: nil)
                Text("Nenhuma execução ativa").font(.system(size: model.display.fontSize, weight: .semibold))
                Spacer()
                Image(systemName: "arrow.up.forward").foregroundStyle(.secondary)
            }
            .padding(12).frame(maxWidth: .infinity, minHeight: model.display.completionHeight)
            .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Nenhuma execução ativa. Abrir Mega Brain")
    }
}

struct IslandRoot: View {
    @ObservedObject var model: IslandModel
    var body: some View {
        let progress = max(0, min(1, model.expansionProgress))
        let detailsProgress = max(0, min(1, (progress - 0.18) / 0.65))
        GeometryReader { geometry in
            VStack(spacing: 0) {
                IslandHeader(model: model, progress: progress)
                ExpandedContent(model: model)
                    .padding(.top, 6)
                    .opacity(detailsProgress)
                    .offset(y: -6 * (1 - detailsProgress))
                    .allowsHitTesting(progress > 0.8)
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .foregroundStyle(.white)
        .preferredColorScheme(.dark)
        .background(Color.black)
        .clipShape(UnevenRoundedRectangle(
            bottomLeadingRadius: min(model.display.cornerRadius, 18 + model.display.cornerRadius * progress),
            bottomTrailingRadius: min(model.display.cornerRadius, 18 + model.display.cornerRadius * progress)
        ))
        .contentShape(Rectangle())
    }
}
