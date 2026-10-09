import AppKit
import SwiftUI

@MainActor
final class IslandModel: ObservableObject {
    @Published var snapshot = IslandSnapshot(live: [], display: nil)
    @Published var expanded = false
    @Published var expansionProgress: CGFloat = 0
    @Published var soundEnabled = true
    @Published var selectedId: String? = nil
    @Published var selectedActivity: LiveActivity? = nil
    @Published var drafts: [String: String] = [:]
    @Published var sending: Set<String> = []
    @Published var replyErrors: [String: String] = [:]
    @Published var replyNotices: [String: String] = [:]
    @Published var connectionError: String? = nil
    @Published var attentionUntil = Date.distantPast
    @Published var dismissedWaiting: Set<String> = []
    @Published private var pendingHiddenProfiles: [String]? = nil
    @Published var profileSettingsError: String? = nil

    let baseURL: URL
    let parentPID: pid_t
    private let token: String
    private let session: URLSession
    private var refreshing = false
    private var initialized = false
    private var timer: Timer?
    private var soundChangePending = false
    var frameChanged: ((Bool, DisplaySettings) -> Void)?
    var inputFocusChanged: ((Bool) -> Void)?

    init(baseURL: URL, parentPID: pid_t, session: URLSession = .shared, token: String? = nil) {
        self.baseURL = baseURL
        self.parentPID = parentPID
        self.session = session
        self.token = token ?? ProcessInfo.processInfo.environment["MEGA_BRAIN_SESSION_TOKEN"] ?? ""
    }

    var display: DisplaySettings {
        var value = snapshot.display ?? DisplaySettings()
        if let pendingHiddenProfiles { value.hiddenCodexProfileIds = pendingHiddenProfiles }
        return value
    }
    var profiles: [CodexProfile] { snapshot.codexProfiles ?? [] }
    var updatingProfiles: Bool { pendingHiddenProfiles != nil }
    var visibleProfileCount: Int { profiles.filter { !display.hiddenCodexProfileIds.contains($0.id) }.count }
    var running: [LiveActivity] {
        snapshot.live.filter { ($0.status == "running" || $0.status == "waiting") && isVisible($0) }
    }
    var recent: [LiveActivity] { (snapshot.recent ?? []).filter { isVisible($0) } }
    var primary: LiveActivity? {
        running.first(where: { $0.id == selectedId }) ?? running.first(where: { $0.status == "waiting" })
            ?? running.first ?? recent.first
    }
    var focusedActivity: LiveActivity? {
        if let selectedId {
            return (running + recent).first { $0.id == selectedId }
                ?? selectedActivity.flatMap { isVisible($0) ? $0 : nil }
        }
        return running.first { $0.status == "waiting" && !dismissedWaiting.contains($0.id) }
    }
    var keepsExpanded: Bool { selectedId != nil || Date() < attentionUntil || !sending.isEmpty }
    var accent: Color { display.color(for: primary?.state ?? "idle") }
    var statusText: String { primary?.stateLabel ?? "Pronto para começar" }
    func petAgent(_ agent: String) -> String { display.petAppearance == "auto" ? agent : display.petAppearance }

    private func isVisible(_ activity: LiveActivity) -> Bool {
        guard let profileId = activity.codexProfileId else { return true }
        return !display.hiddenCodexProfileIds.contains(profileId)
    }

    func setProfileVisible(_ profileId: String, visible: Bool) {
        guard profiles.contains(where: { $0.id == profileId }) else { return }
        var hidden = display.hiddenCodexProfileIds.filter { $0 != profileId }
        if !visible { hidden.append(profileId) }
        setHiddenProfiles(hidden)
    }

    func showAllProfiles() { setHiddenProfiles([]) }

    private func setHiddenProfiles(_ hidden: [String]) {
        guard !updatingProfiles, hidden != display.hiddenCodexProfileIds else { return }
        pendingHiddenProfiles = hidden
        profileSettingsError = nil
        Task {
            defer { pendingHiddenProfiles = nil }
            var change = request("api/activity-island/settings", method: "PUT")
            change.setValue("application/json", forHTTPHeaderField: "Content-Type")
            change.httpBody = try? JSONSerialization.data(withJSONObject: ["hiddenCodexProfileIds": hidden])
            do {
                let (_, response) = try await session.data(for: change)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                if snapshot.display == nil { snapshot.display = DisplaySettings() }
                snapshot.display?.hiddenCodexProfileIds = hidden
                if let selectedActivity, !isVisible(selectedActivity) { closeReply() }
            } catch { profileSettingsError = "Não foi possível salvar os perfis visíveis. Tente novamente." }
        }
    }

    func start() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 0.65, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func setExpanded(_ value: Bool) {
        guard expanded != value else { return }
        expanded = value
        frameChanged?(value, display)
    }

    func select(_ activity: LiveActivity) {
        selectedId = activity.id
        selectedActivity = activity
        dismissedWaiting.remove(activity.id)
        setExpanded(true)
        frameChanged?(true, display)
        if activity.replyMode == "card" { inputFocusChanged?(true) }
    }

    func closeReply() {
        if let activity = focusedActivity, activity.status == "waiting" { dismissedWaiting.insert(activity.id) }
        selectedId = nil
        selectedActivity = nil
        attentionUntil = .distantPast
        inputFocusChanged?(false)
        frameChanged?(expanded, display)
    }

    func request(_ path: String, method: String = "GET", body: [String: String]? = nil) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 12
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    func sendReply(_ activity: LiveActivity) {
        let text = (drafts[activity.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending.contains(activity.id), activity.replyMode == "card" else { return }
        sending.insert(activity.id)
        replyErrors[activity.id] = nil
        replyNotices[activity.id] = nil
        Task {
            defer { sending.remove(activity.id) }
            do {
                let (data, response) = try await session.data(for:
                    request("api/activity-island/reply", method: "POST", body: ["taskId": activity.id, "message": text]))
                let result = try JSONDecoder().decode(IslandReplyResult.self, from: data)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    replyErrors[activity.id] = result.error ?? "Não foi possível enviar. Tente novamente."
                    return
                }
                if drafts[activity.id]?.trimmingCharacters(in: .whitespacesAndNewlines) == text { drafts[activity.id] = "" }
                replyNotices[activity.id] = result.message ?? (result.delivery == "queued"
                    ? "Mensagem salva. Será entregue na próxima chamada do agente." : "Mensagem enviada ao chat do card.")
                refresh()
            } catch {
                replyErrors[activity.id] = "Falha de conexão. Sua resposta foi preservada; tente novamente."
            }
        }
    }

    func toggleSound() {
        guard !soundChangePending else { return }
        let next = !soundEnabled
        soundEnabled = next
        soundChangePending = true
        Task {
            defer { soundChangePending = false }
            var change = request("api/activity-island/settings", method: "PUT")
            change.setValue("application/json", forHTTPHeaderField: "Content-Type")
            change.httpBody = try? JSONSerialization.data(withJSONObject: ["taskSounds": next])
            do {
                let (_, response) = try await session.data(for: change)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                snapshot.display?.taskSounds = next
            } catch { soundEnabled = !next }
        }
    }

    func openMain(target: String = "main", taskId: String? = nil) {
        Task {
            var body = ["target": target]
            if let taskId { body["taskId"] = taskId }
            _ = try? await session.data(for: request("api/activity-intent", method: "POST", body: body))
            NSRunningApplication(processIdentifier: parentPID)?.activate(options: [.activateAllWindows])
        }
    }

    func openActivity(_ activity: LiveActivity) {
        if let threadId = activity.threadId, activity.replyMode == "external", let url = URL(string: "codex://threads/\(threadId)") {
            NSWorkspace.shared.open(url)
        } else if let cardId = activity.cardId { openMain(target: "task", taskId: cardId) }
        else if let threadId = activity.threadId, let url = URL(string: "codex://threads/\(threadId)") {
            NSWorkspace.shared.open(url)
        } else { openMain(target: "agents") }
    }

    func refresh() {
        if kill(parentPID, 0) != 0 { NSApplication.shared.terminate(nil); return }
        guard !refreshing else { return }
        refreshing = true
        Task {
            defer { refreshing = false }
            do {
                let (data, response) = try await session.data(for: request("api/activity-island"))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                let next = try JSONDecoder().decode(IslandSnapshot.self, from: data)
                let oldDisplay = display
                let oldWaiting = Set(running.filter { $0.status == "waiting" }.map { "\($0.id)|\($0.question ?? "")" })
                snapshot = next
                if let selectedId, let updated = (running + recent).first(where: { $0.id == selectedId }) {
                    selectedActivity = updated
                } else if let selectedActivity, !isVisible(selectedActivity) {
                    closeReply()
                }
                connectionError = nil
                if !soundChangePending { soundEnabled = display.taskSounds }
                dismissedWaiting.formIntersection(Set(running.filter { $0.status == "waiting" }.map(\.id)))
                let newWaiting = running.filter { $0.status == "waiting" && !oldWaiting.contains("\($0.id)|\($0.question ?? "")") }
                for activity in newWaiting { dismissedWaiting.remove(activity.id) }
                if display.autoExpandOnWaiting, !newWaiting.isEmpty {
                    attentionUntil = Date().addingTimeInterval(8)
                    setExpanded(true)
                }
                if !initialized || display != oldDisplay { frameChanged?(expanded, display) }
                initialized = true
            } catch { connectionError = "Reconectando ao Mega Brain…" }
        }
    }
}
