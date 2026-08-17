import SwiftUI

enum BeecodeVisual {
    static let accent = Color(red: 0.37, green: 0.31, blue: 0.96)
    static let accentSecondary = Color(red: 0.74, green: 0.28, blue: 0.92)
    static let success = Color(red: 0.12, green: 0.65, blue: 0.48)

    static let accentGradient = LinearGradient(
        colors: [accent, accentSecondary],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static func canvas(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.045, green: 0.047, blue: 0.065)
            : Color(red: 0.975, green: 0.975, blue: 0.99)
    }

    static func surface(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.09, green: 0.092, blue: 0.125)
            : .white
    }

    static func mutedSurface(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.135, green: 0.14, blue: 0.18)
            : Color(red: 0.94, green: 0.94, blue: 0.97)
    }

    static func border(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? .white.opacity(0.1) : .black.opacity(0.075)
    }

    static func userBubble(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.20, green: 0.18, blue: 0.39)
            : Color(red: 0.91, green: 0.90, blue: 1.0)
    }

    static func codeSurface(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.035, green: 0.037, blue: 0.052)
            : Color(red: 0.105, green: 0.105, blue: 0.14)
    }
}

struct BeecodeAmbientBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            BeecodeVisual.canvas(for: colorScheme)

            Circle()
                .fill(BeecodeVisual.accent.opacity(colorScheme == .dark ? 0.17 : 0.11))
                .frame(width: 360, height: 360)
                .blur(radius: 90)
                .offset(x: -150, y: -260)

            Circle()
                .fill(BeecodeVisual.accentSecondary.opacity(colorScheme == .dark ? 0.11 : 0.07))
                .frame(width: 280, height: 280)
                .blur(radius: 100)
                .offset(x: 190, y: -110)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

struct BeecodeMark: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                BeecodeVisual.accentGradient,
                in: .rect(cornerRadius: size * 0.3, style: .continuous)
            )
            .shadow(color: BeecodeVisual.accent.opacity(0.24), radius: size * 0.22, y: size * 0.1)
            .accessibilityHidden(true)
    }
}

private struct BeecodeSurfaceModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let cornerRadius: CGFloat
    let castsShadow: Bool

    func body(content: Content) -> some View {
        content
            .background(
                BeecodeVisual.surface(for: colorScheme),
                in: .rect(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(BeecodeVisual.border(for: colorScheme), lineWidth: 1)
            }
            .shadow(
                color: .black.opacity(castsShadow ? (colorScheme == .dark ? 0.24 : 0.075) : 0),
                radius: castsShadow ? 18 : 0,
                y: castsShadow ? 8 : 0
            )
    }
}

extension View {
    func beecodeSurface(cornerRadius: CGFloat = 18, castsShadow: Bool = false) -> some View {
        modifier(BeecodeSurfaceModifier(cornerRadius: cornerRadius, castsShadow: castsShadow))
    }
}
