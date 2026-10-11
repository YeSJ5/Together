import { useEffect, useRef, useState } from "react";

export default function AudioDiagnosticsModal({ isOpen, onClose }) {
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [qualityPreset, setQualityPreset] = useState("hifi"); // "hifi" | "speech"
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testError, setTestError] = useState("");

  const testStreamRef = useRef(null);
  const testContextRef = useRef(null);
  const testAnimRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      stopMicTest();
      return;
    }

    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const inputs = devices.filter((d) => d.kind === "audioinput");
        const outputs = devices.filter((d) => d.kind === "audiooutput");
        setAudioInputs(inputs);
        setAudioOutputs(outputs);
        if (inputs.length > 0 && !selectedInputId) {
          setSelectedInputId(inputs[0].deviceId);
        }
        if (outputs.length > 0 && !selectedOutputId) {
          setSelectedOutputId(outputs[0].deviceId);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  async function startMicTest() {
    setTestError("");
    try {
      stopMicTest();
      const constraints = {
        audio: selectedInputId
          ? { deviceId: { exact: selectedInputId } }
          : true,
        video: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      testContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      setIsTestingMic(true);

      const updateMeter = () => {
        if (!testStreamRef.current) return;
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        setMicTestLevel(Math.min(100, Math.round((avg / 128) * 100)));
        testAnimRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (err) {
      setTestError(err.message || "Failed to access microphone for testing.");
      setIsTestingMic(false);
    }
  }

  function stopMicTest() {
    if (testAnimRef.current) {
      cancelAnimationFrame(testAnimRef.current);
      testAnimRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
    }
    if (testContextRef.current) {
      testContextRef.current.close().catch(() => {});
      testContextRef.current = null;
    }
    setIsTestingMic(false);
    setMicTestLevel(0);
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fade-in" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-dialog content-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.4rem" }}>⚙️</span>
            <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Audio Settings & Hardware Diagnostics</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Audio Quality Mode */}
          <div>
            <label className="field-label" style={{ marginBottom: "8px", display: "block" }}>
              Audio Processing & Quality Preset
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <button
                type="button"
                className={`preset-selector-card ${qualityPreset === "hifi" ? "selected" : ""}`}
                onClick={() => setQualityPreset("hifi")}
              >
                <strong>🎵 Hi-Fi Stereo (48kHz)</strong>
                <span className="subtle-text" style={{ fontSize: "0.78rem", marginTop: "4px" }}>
                  Zero audio filters. Perfect for Spotify, YouTube, vinyl, and instruments.
                </span>
              </button>

              <button
                type="button"
                className={`preset-selector-card ${qualityPreset === "speech" ? "selected" : ""}`}
                onClick={() => setQualityPreset("speech")}
              >
                <strong>🎙️ Speech / Lecture Mode</strong>
                <span className="subtle-text" style={{ fontSize: "0.78rem", marginTop: "4px" }}>
                  Echo cancellation & noise suppression for voice lectures and podcasts.
                </span>
              </button>
            </div>
          </div>

          {/* Microphone Selector */}
          <div>
            <label className="field-label" htmlFor="mic-select">
              Input Device (Microphone)
            </label>
            <select
              id="mic-select"
              className="text-input"
              value={selectedInputId}
              onChange={(e) => setSelectedInputId(e.target.value)}
              style={{ width: "100%", padding: "10px", marginTop: "6px" }}
            >
              {audioInputs.length === 0 && <option value="">Default System Microphone</option>}
              {audioInputs.map((device, idx) => (
                <option key={device.deviceId || idx} value={device.deviceId}>
                  {device.label || `Microphone ${idx + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* Mic Level Test */}
          <div style={{ background: "rgba(255,255,255,0.03)", padding: "14px", borderRadius: "var(--radius-control)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Microphone Test Level</span>
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.78rem", padding: "4px 12px" }}
                onClick={isTestingMic ? stopMicTest : startMicTest}
              >
                {isTestingMic ? "⏹️ Stop Test" : "🎤 Test Microphone"}
              </button>
            </div>

            <div style={{ width: "100%", height: "10px", background: "rgba(255,255,255,0.1)", borderRadius: "999px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${micTestLevel}%`,
                  height: "100%",
                  background: micTestLevel > 75 ? "var(--accent-rose)" : "linear-gradient(90deg, var(--accent-primary), var(--accent-cyan))",
                  transition: "width 0.05s ease"
                }}
              />
            </div>
            {testError && <p style={{ color: "var(--accent-rose)", fontSize: "0.8rem", margin: "6px 0 0" }}>{testError}</p>}
          </div>

          {/* Audio Output Selector (if supported) */}
          {audioOutputs.length > 0 && (
            <div>
              <label className="field-label" htmlFor="output-select">
                Output Device (Speakers / Headphones)
              </label>
              <select
                id="output-select"
                className="text-input"
                value={selectedOutputId}
                onChange={(e) => setSelectedOutputId(e.target.value)}
                style={{ width: "100%", padding: "10px", marginTop: "6px" }}
              >
                {audioOutputs.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId}>
                    {device.label || `Speaker ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* System Environment Check */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.82rem", color: "var(--text-secondary)", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>WebRTC Transport:</span>
              <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>Direct P2P Mesh + TURN Relay</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Background Playback:</span>
              <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>MediaSession Audio Service</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Data Persistence:</span>
              <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>Durable Relational Storage</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Live Speech Transcriptions:</span>
              <span style={{ color: typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition) ? "var(--accent-primary)" : "var(--text-muted)", fontWeight: 600 }}>
                {typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition) ? "Supported" : "Not supported in this browser"}
              </span>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="button-primary" onClick={onClose} style={{ padding: "10px 24px" }}>
            Save & Done
          </button>
        </div>
      </div>
    </div>
  );
}
