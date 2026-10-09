import AppKit
import QuartzCore
import SwiftUI

let hardwareNotchWidth: CGFloat = 185
let compactHeight: CGFloat = 38

final class NotchPanel: NSPanel {
    var dismissInput: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { dismissInput?() }
}

@MainActor
final class PanelController {
    let panel: NotchPanel
    let model: IslandModel
    private var hoverTimer: Timer?
    private var frameTimer: Timer?

    init(baseURL: URL, parentPID: pid_t) {
        model = IslandModel(baseURL: baseURL, parentPID: parentPID)
        panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovable = false
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.contentView = NSHostingView(rootView: IslandRoot(model: model))
        model.frameChanged = { [weak self] expanded, display in self?.place(expanded: expanded, display: display) }
        model.inputFocusChanged = { [weak self] editing in
            guard let self else { return }
            if editing { self.panel.makeKeyAndOrderFront(nil) }
            else { self.panel.makeFirstResponder(nil); self.panel.resignKey() }
        }
        panel.dismissInput = { [weak model] in model?.closeReply() }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                              object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.place(expanded: self.model.expanded, display: self.model.display)
            }
        }
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateHover() }
        }
        model.start()
    }

    private func updateHover() {
        guard panel.isVisible, model.display.enabled else { model.setExpanded(false); return }
        let margin: CGFloat = model.expanded ? 8 : 0
        let inside = panel.frame.insetBy(dx: -margin, dy: -margin).contains(NSEvent.mouseLocation)
        model.setExpanded(inside || model.keepsExpanded)
    }

    func place(expanded: Bool, display: DisplaySettings) {
        guard display.enabled else {
            frameTimer?.invalidate()
            model.inputFocusChanged?(false)
            panel.orderOut(nil)
            return
        }
        guard let screen = screenFor(display.monitorId) ?? NSScreen.screens.first else { return }
        let size = NSSize(
            width: min(screen.frame.width, expanded ? display.maxWidth : display.compactWidth),
            height: min(screen.frame.height, expanded ? display.maxHeight : compactHeight)
        )
        let frame = screen.frame
        let target = NSRect(x: frame.midX - size.width / 2, y: frame.maxY - size.height, width: size.width, height: size.height)
        guard panel.isVisible else {
            panel.setFrame(target, display: true)
            model.expansionProgress = expanded ? 1 : 0
            panel.orderFrontRegardless()
            return
        }
        frameTimer?.invalidate()
        let initial = panel.frame
        let initialProgress = model.expansionProgress
        let targetProgress: CGFloat = expanded ? 1 : 0
        if initial.equalTo(target) {
            model.expansionProgress = targetProgress
            panel.setFrame(target, display: true)
            return
        }
        if !display.animations || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            model.expansionProgress = targetProgress
            panel.setFrame(target, display: true)
            return
        }
        let startedAt = CACurrentMediaTime()
        let duration = 0.22 * 100 / display.animationSpeed
        let screenTop = target.maxY
        let screenCenter = target.midX
        let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            let elapsed = CACurrentMediaTime() - startedAt
            let progress = min(1, elapsed / duration)
            let eased = 1 - pow(1 - progress, 3)
            let visualProgress = initialProgress + (targetProgress - initialProgress) * CGFloat(eased)
            let width = initial.width + (target.width - initial.width) * eased
            let height = initial.height + (target.height - initial.height) * eased
            let frame = NSRect(
                x: screenCenter - width / 2,
                y: screenTop - height,
                width: width,
                height: height
            )
            MainActor.assumeIsolated {
                self.model.expansionProgress = visualProgress
            }
            self.panel.setFrame(frame, display: true)
            if progress >= 1 {
                timer.invalidate()
                MainActor.assumeIsolated {
                    self.model.expansionProgress = targetProgress
                }
                self.panel.setFrame(target, display: true)
            }
        }
        frameTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func screenFor(_ id: String?) -> NSScreen? {
        guard let name = id?.split(separator: "|").first.map(String.init) else { return NSScreen.screens.first }
        return NSScreen.screens.first { $0.localizedName == name }
    }
}

@main
struct ActivityIslandMain {
    @MainActor
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count >= 3,
              let baseURL = URL(string: arguments[1]),
              let parent = Int32(arguments[2]) else {
            fputs("Usage: activity-island <base-url> <parent-pid>\n", stderr)
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let controller = PanelController(baseURL: baseURL, parentPID: parent)
        withExtendedLifetime(controller) { app.run() }
    }
}
