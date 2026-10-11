// Browser Speech Recognition for Live Captions & Lecture Mode

export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createSpeechRecognizer({ onTranscript, onError }) {
  if (!isSpeechRecognitionSupported()) {
    return null;
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognizer = new SpeechRec();

  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";

  recognizer.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcriptPiece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcriptPiece;
      } else {
        interimTranscript += transcriptPiece;
      }
    }

    if (finalTranscript.trim()) {
      onTranscript?.({ text: finalTranscript.trim(), isFinal: true });
    } else if (interimTranscript.trim()) {
      onTranscript?.({ text: interimTranscript.trim(), isFinal: false });
    }
  };

  recognizer.onerror = (err) => {
    // Only alert on real errors, ignore no-speech or aborted
    if (err.error !== "no-speech" && err.error !== "aborted") {
      onError?.(err);
    }
  };

  return recognizer;
}
