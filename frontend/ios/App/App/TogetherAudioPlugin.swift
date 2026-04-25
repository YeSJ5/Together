import AVFoundation
import Capacitor
import MediaPlayer

@objc(TogetherAudioPlugin)
public class TogetherAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TogetherAudioPlugin"
    public let jsName = "TogetherAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBackgroundPlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disableBackgroundPlayback", returnType: CAPPluginReturnPromise)
    ]

    private let audioSession = AVAudioSession.sharedInstance()

    @objc func getCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "nativeAndroid": false,
            "nativeIOS": true,
            "systemAudioCapture": false,
            "backgroundPlaybackService": true,
            "microphoneHostMode": true,
            "audioFileHostMode": true
        ])
    }

    @objc func enableBackgroundPlayback(_ call: CAPPluginCall) {
        do {
            try audioSession.setCategory(.playback, mode: .default, options: [])
            try audioSession.setActive(true)
            UIApplication.shared.beginReceivingRemoteControlEvents()
            call.resolve()
        } catch {
            call.reject("iOS background playback could not be enabled.", nil, error)
        }
    }

    @objc func disableBackgroundPlayback(_ call: CAPPluginCall) {
        do {
            try audioSession.setActive(false, options: [.notifyOthersOnDeactivation])
            UIApplication.shared.endReceivingRemoteControlEvents()
            call.resolve()
        } catch {
            call.reject("iOS background playback could not be disabled.", nil, error)
        }
    }
}
