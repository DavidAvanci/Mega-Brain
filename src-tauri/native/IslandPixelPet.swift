import AppKit
import SwiftUI

struct PixelPet: View {
    let color: Color
    let state: String
    let agent: String
    var size: CGFloat = 24
    var animations = true
    var speed: Double = 100
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var animates: Bool { animations && !reduceMotion && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: !animates)) { timeline in
            let time = animates ? timeline.date.timeIntervalSinceReferenceDate * max(0.25, speed / 100) : 0
            Canvas { context, canvasSize in draw(context: &context, size: canvasSize, time: time) }
                .offset(y: verticalOffset(time))
                .rotationEffect(.degrees(rotation(time)))
                .scaleEffect(scale(time))
        }
        .frame(width: size, height: size * 0.78)
        .shadow(color: color.opacity(state == "waiting" || state == "error" ? 0.6 : 0.32), radius: size / 6)
        .accessibilityHidden(true)
    }

    private func draw(context: inout GraphicsContext, size: CGSize, time: Double) {
        let cells = agent == "claude"
            ? [(2, 1), (5, 1), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (1, 3), (3, 3), (4, 3), (6, 3), (2, 4), (3, 4), (4, 4), (5, 4)]
            : [(1, 2), (2, 1), (3, 2), (4, 2), (5, 1), (6, 2), (1, 3), (2, 3), (3, 3), (4, 3), (5, 3), (6, 3), (2, 4), (5, 4)]
        let unit = size.width / 9
        for (x, y) in cells { pixel(x, y, unit: unit, context: &context) }
        let blink = animates && Int(time * 2) % 13 == 0
        if blink && state != "waiting" && state != "error" {
            for x in [2, 5] {
                context.fill(Path(CGRect(x: CGFloat(x) * unit, y: 3 * unit, width: unit, height: unit / 2)), with: .color(.black))
            }
        }
        let phase = Int(time * 4) % 3
        switch state {
        case "thinking":
            for index in 0..<3 {
                pixel(6 + index, index == phase ? 0 : 1, unit: unit, opacity: index == phase ? 0.95 : 0.35, context: &context)
            }
        case "reading":
            for x in 2...6 { pixel(x, 6, unit: unit, opacity: x == phase + 2 ? 1 : 0.3, context: &context) }
        case "editing":
            pixel(6 + phase % 2, 4, unit: unit, context: &context)
            pixel(7 + phase % 2, 3, unit: unit, context: &context)
            pixel(8, 2, unit: unit, opacity: 0.45, context: &context)
        case "testing":
            for x in 0..<3 { pixel(x * 2 + 2, 6, unit: unit, opacity: x <= phase ? 1 : 0.2, context: &context) }
        case "waiting":
            pixel(8, 1, unit: unit, context: &context)
            pixel(8, 2, unit: unit, context: &context)
            pixel(8, 4, unit: unit, context: &context)
        case "complete":
            for (x, y) in [(6, 5), (7, 6), (8, 5), (8, 4)] { pixel(x, y, unit: unit, context: &context) }
        case "error":
            for (x, y) in [(7, 0), (8, 1), (7, 2), (8, 0), (7, 1), (8, 2)] { pixel(x, y, unit: unit, context: &context) }
        case "idle", "stopped": break
        default:
            pixel(phase + 1, 6, unit: unit, opacity: 0.5, context: &context)
            pixel(phase + 4, 6, unit: unit, opacity: 0.85, context: &context)
        }
    }

    private func pixel(_ x: Int, _ y: Int, unit: CGFloat, opacity: Double = 1, context: inout GraphicsContext) {
        context.fill(Path(CGRect(x: CGFloat(x) * unit, y: CGFloat(y) * unit, width: unit, height: unit)), with: .color(color.opacity(opacity)))
    }

    private func verticalOffset(_ time: Double) -> CGFloat {
        guard animates else { return 0 }
        switch state {
        case "working", "editing": return sin(time * 7) * 0.8
        case "thinking": return sin(time * 3) * 0.5
        case "testing": return sin(time * 10) * 0.45
        case "complete": return -abs(sin(time * 3)) * 1.4
        default: return 0
        }
    }

    private func rotation(_ time: Double) -> Double {
        guard animates else { return 0 }
        if state == "thinking" { return sin(time * 2) * 5 }
        if state == "error" { return sin(time * 12) * 3 }
        return 0
    }

    private func scale(_ time: Double) -> CGFloat {
        guard animates else { return 1 }
        if state == "waiting" { return 1 + sin(time * 3) * 0.045 }
        if state == "reading" { return 1 + sin(time * 2) * 0.015 }
        return 1
    }
}
