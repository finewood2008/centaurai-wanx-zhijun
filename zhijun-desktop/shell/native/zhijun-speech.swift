import Foundation
import Speech
import Darwin

let locale = "zh-CN"
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
var recognitionTask: SFSpeechRecognitionTask?

func output(_ payload: [String: Any], success: Bool = true) -> Never {
    var result = payload
    result["ok"] = success
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
    exit(success ? 0 : 1)
}

func fail(_ code: String, _ message: String) -> Never {
    output(["code": code, "message": message], success: false)
}

func statusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .authorized: return "authorized"
    @unknown default: return "restricted"
    }
}

func capability() -> [String: Any] {
    let status = SFSpeechRecognizer.authorizationStatus()
    let supports = recognizer?.supportsOnDeviceRecognition ?? false
    var result: [String: Any] = [
        "locale": locale,
        "supportsOnDeviceRecognition": supports,
        "authorizationStatus": statusName(status),
        "available": supports && (recognizer?.isAvailable ?? false)
            && status != .denied && status != .restricted,
    ]
    if status == .denied || status == .restricted {
        result["reason"] = "PERMISSION_DENIED"
        result["message"] = "设备端语音识别权限未获允许，请在系统设置中检查。"
    } else if !supports {
        result["reason"] = "ON_DEVICE_UNAVAILABLE"
        result["message"] = "本机暂不支持中文设备端语音识别，未切换至云端。"
    } else if !(recognizer?.isAvailable ?? false) {
        result["reason"] = "RECOGNIZER_UNAVAILABLE"
        result["message"] = "本机中文语音识别暂时不可用，请稍后重试。"
    }
    return result
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("INVALID_REQUEST", "语音助手命令无效。") }
switch arguments[1] {
case "capability":
    guard arguments.count == 2 else { fail("INVALID_REQUEST", "语音助手命令无效。") }
    // This operation never requests permission or starts a recognition task.
    output(capability())
case "authorize":
    guard arguments.count == 2 else { fail("INVALID_REQUEST", "语音助手命令无效。") }
    guard recognizer?.supportsOnDeviceRecognition == true else { output(capability()) }
    SFSpeechRecognizer.requestAuthorization { _ in output(capability()) }
case "transcribe":
    guard arguments.count == 3 else { fail("INVALID_REQUEST", "语音助手命令无效。") }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
        fail("PERMISSION_DENIED", "请先允许知君使用设备端语音识别。")
    }
    guard let recognizer, recognizer.supportsOnDeviceRecognition else {
        fail("ON_DEVICE_UNAVAILABLE", "本机暂不支持中文设备端语音识别，未切换至云端。")
    }
    guard recognizer.isAvailable else {
        fail("RECOGNIZER_UNAVAILABLE", "本机中文语音识别暂时不可用，请稍后重试。")
    }
    let url = URL(fileURLWithPath: arguments[2])
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
          size > 44, size <= 2 * 1024 * 1024 else {
        fail("INVALID_AUDIO", "录音文件大小不符合要求。")
    }
    // Node validates the 16kHz/mono/PCM16 WAV duration before writing this file.
    // Never start a task without both guards: Apple only honors this flag when
    // supportsOnDeviceRecognition is true.
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    recognitionTask = recognizer.recognitionTask(with: request) { result, error in
        if let result, result.isFinal {
            let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { fail("NO_SPEECH", "没有识别到可用文字，请重试。") }
            output(["text": text, "locale": locale])
        }
        if error != nil {
            // Do not return engine diagnostics or audio content in error logs.
            fail("RECOGNITION_FAILED", "本机语音转写失败，请重试。")
        }
    }
default:
    fail("INVALID_REQUEST", "语音助手命令无效。")
}

DispatchQueue.main.asyncAfter(deadline: .now() + 55) {
    recognitionTask?.cancel()
    fail("TIMEOUT", "本机语音转写超时，请缩短录音后重试。")
}
dispatchMain()
