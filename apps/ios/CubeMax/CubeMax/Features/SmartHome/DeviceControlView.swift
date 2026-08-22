import SwiftUI
import UIKit

struct DeviceControlView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let device: HomeAssistantDevice

    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var colorHex: String
    @State private var brightnessDraft: Double
    @State private var colorTempDraft: Double

    private var liveDevice: HomeAssistantDevice {
        model.devices.first(where: { $0.id == device.id }) ?? device
    }

    init(device: HomeAssistantDevice) {
        self.device = device
        _colorHex = State(initialValue: device.state.color ?? "#ffffff")
        _brightnessDraft = State(initialValue: device.state.brightness ?? 100)
        _colorTempDraft = State(initialValue: device.state.colorTemp ?? device.state.minKelvin ?? 2700)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 13) {
                        Image(systemName: liveDevice.online ? "lightbulb.2.fill" : "lightbulb.slash")
                            .font(.title2)
                            .foregroundStyle(liveDevice.online ? .orange : .secondary)
                            .frame(width: 48, height: 48)
                            .background((liveDevice.online ? Color.orange : Color.secondary).opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(liveDevice.name).font(.headline)
                            Text([liveDevice.categoryLabel, liveDevice.areaName, liveDevice.entityId].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Label(liveDevice.online ? "在线" : "离线", systemImage: "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(liveDevice.online ? .green : .secondary)
                        }
                    }
                    .padding(.vertical, 5)
                }

                if liveDevice.domain == "light" {
                    Section("灯光") {
                        Toggle("电源", isOn: Binding(
                            get: { liveDevice.state.on },
                            set: { send(.init(on: $0)) }
                        ))
                        .disabled(isBusy)

                        if liveDevice.supportsBrightness {
                            VStack(alignment: .leading) {
                                HStack {
                                    Text("亮度")
                                    Spacer()
                                    Text("\(Int(brightnessDraft))%")
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                                Slider(value: $brightnessDraft, in: 1...100, step: 1) { editing in
                                    if !editing { send(.init(on: true, brightness: Int(brightnessDraft.rounded()))) }
                                }
                                .disabled(isBusy)
                            }
                        }

                        if liveDevice.supportsColor {
                            ColorPicker("颜色", selection: Binding(
                                get: { Color(hex: colorHex) },
                                set: { color in
                                    let hex = color.hexString
                                    colorHex = hex
                                    send(.init(on: true, color: hex))
                                }
                            ), supportsOpacity: false)
                            .disabled(isBusy)
                        }

                        if liveDevice.supportsColorTemp {
                            VStack(alignment: .leading) {
                                HStack {
                                    Text("色温")
                                    Spacer()
                                    Text("\(Int(colorTempDraft)) K")
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                                Slider(
                                    value: $colorTempDraft,
                                    in: (liveDevice.state.minKelvin ?? 1700)...(liveDevice.state.maxKelvin ?? 6500),
                                    step: 50
                                ) { editing in
                                    if !editing { send(.init(on: true, colorTemp: Int(colorTempDraft.rounded()))) }
                                }
                                .disabled(isBusy)
                            }
                        }
                    }
                } else if liveDevice.domain == "switch" {
                    Section("开关") {
                        Toggle("电源", isOn: Binding(
                            get: { liveDevice.state.on },
                            set: { send(.init(on: $0)) }
                        ))
                        .disabled(isBusy)
                    }
                } else {
                    Section {
                        Text("该类型会先列出来，控制能力会按灯光的方式逐步补齐。")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("设备控制")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { refresh() } label: {
                        if isBusy { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                    }
                    .disabled(isBusy)
                }
            }
            .alert("控制失败", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("知道了") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func send(_ command: HomeAssistantLightCommand) {
        guard !isBusy else { return }
        isBusy = true
        Task {
            do { try await model.controlDevice(liveDevice, command: command) }
            catch { errorMessage = error.localizedDescription }
            isBusy = false
        }
    }

    private func refresh() {
        isBusy = true
        Task {
            do { try await model.refreshDevice(liveDevice) }
            catch { errorMessage = error.localizedDescription }
            isBusy = false
        }
    }
}

private extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }

    var hexString: String {
        let ui = UIColor(self)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        ui.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return String(format: "#%02x%02x%02x", Int(red * 255), Int(green * 255), Int(blue * 255))
    }
}
