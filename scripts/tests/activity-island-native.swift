// Compile with IslandModels.swift and IslandModel.swift; never launches an agent or a visible panel.
import AppKit
import Foundation

final class IslandTestProtocol: URLProtocol {
    static var status = 200
    static var payload = Data()
    static var delay: TimeInterval = 0
    static var requests: [URLRequest] = []
    static var requestBodies: [Data] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(contentsOf: buffer.prefix(count))
            }
            stream.close()
        }
        Self.requestBodies.append(body)
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!
        let payload = Self.payload
        let finish = {
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: payload)
            self.client?.urlProtocolDidFinishLoading(self)
        }
        if Self.delay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + Self.delay, execute: finish) }
        else { finish() }
    }
    override func stopLoading() {}
}

@main
struct IslandNativeChecks {
    @MainActor
    static func waitFor(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        preconditionFailure("Native island async check timed out")
    }

    @MainActor
    static func checkProfiles(_ decoder: JSONDecoder) async throws {
        let legacy = try decoder.decode(IslandSnapshot.self, from: Data("{\"live\":[]}".utf8))
        precondition(legacy.codexProfiles == nil && legacy.activeCodexProfileId == nil,
                     "Existing snapshots must decode without profile metadata")
        let customized = try decoder.decode(DisplaySettings.self, from:
            Data("{\"hiddenCodexProfileIds\":[\"work\"],\"showProfileBadge\":false}".utf8))
        precondition(customized.hiddenCodexProfileIds == ["work"] && !customized.showProfileBadge)

        let payload = Data("""
        {
          "live": [
            {"taskId":"work-task","cardId":"MB-003","title":"Atualizar API","agent":"codex","status":"waiting",
             "checked":1,"total":3,"visualState":"waiting","question":"Qual ambiente?","replyMode":"card",
             "codexProfileId":"work","codexProfileName":"Takeat","codexProfileColor":"#64B8FF"},
            {"taskId":"personal-task","title":"Melhorar a ilha","agent":"codex","status":"running","checked":0,"total":0,
             "codexProfileId":"personal","codexProfileName":"Pessoal","codexProfileColor":"#B69CFF"},
            {"taskId":"claude-task","title":"Revisar testes","agent":"claude","status":"running","checked":0,"total":0}
          ],
          "recent": [
            {"taskId":"work-complete","title":"Corrigir relatório","agent":"codex","status":"complete","checked":2,"total":2,
             "codexProfileId":"work","codexProfileName":"Takeat","codexProfileColor":"#64B8FF"}
          ],
          "codexProfiles": [
            {"id":"personal","name":"Pessoal","home":"/tmp/codex-personal","color":"#B69CFF"},
            {"id":"work","name":"Takeat","home":"/tmp/codex-work","color":"#64B8FF"}
          ],
          "activeCodexProfileId":"personal",
          "display": {}
        }
        """.utf8)
        let snapshot = try decoder.decode(IslandSnapshot.self, from: payload)
        precondition(snapshot.codexProfiles?.map(\.id) == ["personal", "work"])
        precondition(snapshot.codexProfiles?.last?.home == "/tmp/codex-work")
        precondition(snapshot.live[0].codexProfileId == "work" && snapshot.live[0].codexProfileName == "Takeat")
        precondition(snapshot.live[0].codexProfileColor == "#64B8FF" && snapshot.live[2].codexProfileId == nil)

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [IslandTestProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let model = IslandModel(baseURL: URL(string: "http://127.0.0.1:43210")!, parentPID: getpid(),
                                session: session, token: "profile-test-capability")
        model.snapshot = snapshot
        let waiting = snapshot.live[0]
        model.select(waiting)
        model.drafts[waiting.id] = "Use homologação, sem alterar a produção"
        precondition(model.profiles.count == 2 && model.visibleProfileCount == 2)

        IslandTestProtocol.requests = []
        IslandTestProtocol.requestBodies = []
        IslandTestProtocol.status = 500
        IslandTestProtocol.delay = 0.08
        IslandTestProtocol.payload = Data("{\"error\":\"Falha ao salvar\"}".utf8)
        model.setProfileVisible("work", visible: false)
        precondition(model.updatingProfiles && model.display.hiddenCodexProfileIds == ["work"],
                     "Profile visibility must update while saving")
        precondition(model.running.map(\.id) == ["personal-task", "claude-task"] && model.recent.isEmpty)
        precondition(model.focusedActivity == nil && model.drafts[waiting.id] == "Use homologação, sem alterar a produção",
                     "Hiding a profile must hide its composer while retaining the draft")
        try await waitFor { !model.updatingProfiles }
        precondition(model.profileSettingsError != nil && model.display.hiddenCodexProfileIds.isEmpty,
                     "Rejected visibility changes must restore the previous settings")
        precondition(model.running.count == 3 && model.recent.count == 1 && model.focusedActivity?.id == waiting.id)
        precondition(model.drafts[waiting.id] == "Use homologação, sem alterar a produção")
        precondition(model.snapshot.activeCodexProfileId == "personal")

        IslandTestProtocol.status = 200
        IslandTestProtocol.payload = Data("{}".utf8)
        model.setProfileVisible("work", visible: false)
        try await waitFor { !model.updatingProfiles }
        precondition(model.profileSettingsError == nil && model.display.hiddenCodexProfileIds == ["work"])
        precondition(model.running.map(\.id) == ["personal-task", "claude-task"] && model.recent.isEmpty)
        precondition(model.selectedId == nil && model.focusedActivity == nil,
                     "A saved hidden profile must close its selected composer")
        precondition(model.drafts[waiting.id] == "Use homologação, sem alterar a produção")
        precondition(model.visibleProfileCount == 1 && model.snapshot.activeCodexProfileId == "personal",
                     "Filtering profiles must not change the profile used for launches")
        let visibilityRequest = IslandTestProtocol.requests.last!
        precondition(visibilityRequest.url?.path == "/api/activity-island/settings" && visibilityRequest.httpMethod == "PUT")
        precondition(visibilityRequest.value(forHTTPHeaderField: "Authorization") == "Bearer profile-test-capability")
        precondition(visibilityRequest.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try JSONSerialization.jsonObject(with: IslandTestProtocol.requestBodies.last!) as! [String: Any]
        precondition(Set(body.keys) == ["hiddenCodexProfileIds"] && body["hiddenCodexProfileIds"] as? [String] == ["work"],
                     "The island visibility operation must patch only hidden profile IDs")

        model.showAllProfiles()
        precondition(model.running.count == 3 && model.recent.count == 1 && model.visibleProfileCount == 2)
        try await waitFor { !model.updatingProfiles }
        precondition(model.display.hiddenCodexProfileIds.isEmpty && model.snapshot.activeCodexProfileId == "personal")
        let beforeUnknown = IslandTestProtocol.requests.count
        model.setProfileVisible("unknown-profile", visible: false)
        precondition(!model.updatingProfiles && IslandTestProtocol.requests.count == beforeUnknown,
                     "Unknown profiles must not create a visibility request")
        IslandTestProtocol.delay = 0
    }

    @MainActor
    static func main() async throws {
        let decoder = JSONDecoder()
        let legacy = try decoder.decode(DisplaySettings.self, from: Data("{\"fontSize\":12}".utf8))
        precondition(legacy.fontSize == 12 && legacy.animations && legacy.petAppearance == "auto")
        precondition(legacy.waitingColor == "#FFB454" && legacy.compactOthers)
        precondition(legacy.hiddenCodexProfileIds.isEmpty && legacy.showProfileBadge,
                     "Older settings must show all profiles and their badges")
        let customized = try decoder.decode(DisplaySettings.self, from: Data("{\"petSize\":32,\"animations\":false,\"animationSpeed\":75,\"waitingColor\":\"#123456\",\"petAppearance\":\"claude\",\"autoExpandOnWaiting\":false}".utf8))
        precondition(customized.petSize == 32 && !customized.animations && customized.animationSpeed == 75)
        precondition(customized.waitingColor == "#123456" && !customized.autoExpandOnWaiting)

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [IslandTestProtocol.self]
        let session = URLSession(configuration: config)
        let model = IslandModel(baseURL: URL(string: "http://127.0.0.1:43210")!, parentPID: getpid(), session: session, token: "native-test-capability")
        IslandTestProtocol.payload = Data("{\"live\":[{\"taskId\":\"card:stage\",\"cardId\":\"card\",\"title\":\"Revisar API\",\"agent\":\"codex\",\"status\":\"waiting\",\"visualState\":\"waiting\",\"question\":\"Qual ambiente?\",\"replyMode\":\"card\",\"checked\":1,\"total\":3}],\"display\":{}}".utf8)
        model.refresh()
        try await waitFor { model.running.count == 1 }
        precondition(model.expanded && model.keepsExpanded && model.statusText == "Aguardando resposta")
        let activity = model.running[0]
        var focusRequested = false
        model.inputFocusChanged = { focusRequested = $0 }
        model.select(activity)
        precondition(focusRequested && model.focusedActivity?.id == activity.id)
        model.drafts[activity.id] = "Use homologação"

        IslandTestProtocol.status = 409
        IslandTestProtocol.payload = Data("{\"error\":\"A execução mudou\"}".utf8)
        model.sendReply(activity)
        try await waitFor { model.replyErrors[activity.id] != nil }
        precondition(model.drafts[activity.id] == "Use homologação")
        precondition(IslandTestProtocol.requests.last?.url?.path == "/api/activity-island/reply")
        precondition(IslandTestProtocol.requests.last?.value(forHTTPHeaderField: "Authorization") == "Bearer native-test-capability")

        IslandTestProtocol.status = 200
        IslandTestProtocol.delay = 0.05
        IslandTestProtocol.payload = Data("{\"delivery\":\"queued\",\"message\":\"Pendente\"}".utf8)
        model.sendReply(activity)
        model.drafts[activity.id] = "Outra orientação"
        try await waitFor { model.replyNotices[activity.id] != nil }
        precondition(model.drafts[activity.id] == "Outra orientação", "A successful reply must not erase newer input")
        precondition(model.replyErrors[activity.id] == nil)

        model.closeReply()
        precondition(model.focusedActivity == nil, "Dismissed questions must not immediately reopen")
        precondition(model.drafts[activity.id] == "Outra orientação")
        model.select(activity)
        precondition(model.focusedActivity?.id == activity.id, "Explicit selection must reopen a dismissed question")

        model.snapshot.live = []
        precondition(model.focusedActivity?.id == activity.id && model.drafts[activity.id] == "Outra orientação")
        model.closeReply()
        precondition(!focusRequested && model.selectedId == nil)
        precondition(model.drafts[activity.id] == "Outra orientação", "Closing must preserve drafts")
        try await waitFor { !model.sending.contains(activity.id) && model.connectionError != nil }
        session.invalidateAndCancel()
        try await checkProfiles(decoder)
        print("Native island checks passed: defaults, live state, attention, keyboard focus, authenticated reply, failure recovery, concurrent draft, selection retention, question dismissal, profile metadata, visibility, rollback, authenticated profile patch, preserved default profile.")
    }
}
