import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Volume2, VolumeX, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const SYSTEM_INSTRUCTION = `You are John, a professional and friendly MALE voice assistant for Meshi Tuviana. 
It is CRITICAL that you maintain a masculine persona. 
You speak English, French, and Brazilian Portuguese. 
When speaking Portuguese, you MUST use a natural Brazilian accent and vocabulary.

Your goal is to provide information about Meshi's professional background, skills, and experience based on her resume.

Meshi's Profile:
- Name: Meshi Tuviana
- Education: Bachelor Fashion Business ESMOD Paris (Sept 2024 - Present). Specializations: fashion marketing, brand strategy, merchandising.
- Professional Experience:
    - Pop-up Store Coordinator - Highlight Studio, Paris (2025): Managed daily operations, sales, and team coordination for a designer pop-up.
    - Marketing, Styling & Content Creation - Mon Cheri, Paris (2024-2025): Assisted on marketing projects for a jewelry brand, organized shoots, and supported social media.
    - Stylist Assistant & Production Assistant - Tel Aviv (2023): Worked on TV and commercial productions, coordinated logistics and styling.
    - Sales Advisor - Factory 54, Tel Aviv (2021-2022): Luxury brand sales, personalized styling advice.
    - Sales Advisor - Helga Designs, Tel Aviv (2021): High-end boutique customer service.
    - Store Manager - Billabong, Tel Aviv (2019-2021): Managed store operations, sales performance, and a team of 14.
- Skills: Fashion marketing, brand strategy, merchandising, Excel, Word, PPT, Canva, Photoshop.
- Languages: Hebrew (native), English (fluent), French (B1).
- Interests: Luxury fashion, visual branding, digital marketing, interior design, sustainable fashion.

To start the conversation, you MUST say: "Holla i'm John . what would you like to know about Meshi." 
Always respond as a man. Use a Brazilian accent for Portuguese. Be helpful and professional.`;

export default function VoiceAssistant() {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsActive(false);
    setStatus("idle");
  }, []);

  const playNextInQueue = useCallback(async () => {
    if (audioQueue.current.length === 0 || isPlayingRef.current || !audioContextRef.current) {
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueue.current.shift()!;
    
    // Convert Int16Array to Float32Array for Web Audio API
    const float32Data = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32Data[i] = chunk[i] / 32768.0;
    }

    const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      isPlayingRef.current = false;
      playNextInQueue();
    };

    source.start();
  }, []);

  const startSession = async () => {
    try {
      setStatus("connecting");
      
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      sessionRef.current = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          generationConfig: {
            temperature: 0.7,
          }
        },
        callbacks: {
          onopen: async () => {
            setStatus("active");
            setIsActive(true);
            
            // Start microphone
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            
            // We need a simple processor to send audio chunks
            // For brevity in this environment, we'll use a ScriptProcessorNode or similar if worklet is too complex to setup quickly
            // But standard practice is AudioWorklet. Let's try a basic approach.
            
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
            
            processor.onaudioprocess = (e) => {
              if (isMuted || !sessionRef.current) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              // Downsample/Convert to Int16
              const int16Data = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16Data[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              
              // Convert to base64
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
              
              sessionRef.current.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const int16Array = new Int16Array(bytes.buffer);
                  audioQueue.current.push(int16Array);
                  playNextInQueue();
                }
                if (part.text) {
                  setTranscript(prev => prev + " " + part.text);
                }
              }
            }
            
            if (message.serverContent?.interrupted) {
              audioQueue.current = [];
              isPlayingRef.current = false;
              // In a real app, we'd stop current playback
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setStatus("error");
            stopSession();
          },
          onclose: () => {
            setStatus("idle");
            setIsActive(false);
          }
        }
      });

    } catch (err) {
      console.error("Failed to start session:", err);
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 relative">
      <div className="atmosphere" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="font-serif text-5xl md:text-7xl mb-4 tracking-tight text-accent">
          MESHI TUVIANA
        </h1>
        <p className="font-sans text-sm uppercase tracking-[0.3em] opacity-60">
          John - Personal Assistant Interface
        </p>
      </motion.div>

      <div className="relative w-64 h-64 flex items-center justify-center">
        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 0.2 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ repeat: Infinity, duration: 2, repeatType: "reverse" }}
              className="absolute inset-0 bg-accent rounded-full blur-3xl"
            />
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isActive ? stopSession : startSession}
          disabled={status === "connecting"}
          className={`z-10 w-48 h-48 rounded-full flex items-center justify-center glass-panel transition-all duration-500 ${
            isActive ? 'border-accent shadow-[0_0_30px_rgba(212,175,55,0.3)]' : 'border-white/10'
          }`}
        >
          {status === "connecting" ? (
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : isActive ? (
            <Mic className="w-16 h-16 text-accent" />
          ) : (
            <MicOff className="w-16 h-16 opacity-40" />
          )}
        </motion.button>
      </div>

      <div className="mt-12 flex flex-col items-center gap-6 w-full max-w-md">
        <div className="flex gap-4">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-4 rounded-full glass-panel hover:bg-white/5 transition-colors"
          >
            {isMuted ? <MicOff className="w-6 h-6 text-red-400" /> : <Mic className="w-6 h-6" />}
          </button>
          <div className="flex items-center px-6 rounded-full glass-panel gap-3">
            <Volume2 className="w-5 h-5 opacity-60" />
            <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div 
                animate={{ width: isActive ? "100%" : "0%" }}
                className="h-full bg-accent"
              />
            </div>
          </div>
        </div>

        <div className="w-full glass-panel rounded-2xl p-6 min-h-[120px] max-h-[200px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3 opacity-40 text-xs uppercase tracking-widest">
            <MessageSquare className="w-3 h-3" />
            <span>Live Transcript</span>
          </div>
          <p className="text-sm leading-relaxed opacity-80 italic">
            {isActive ? (transcript || "Listening...") : "Press the microphone to start talking to John."}
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 left-8 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-widest opacity-30">Status</span>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 
            status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
            status === 'error' ? 'bg-red-500' : 'bg-white/20'
          }`} />
          <span className="text-xs font-mono opacity-50 capitalize">{status}</span>
        </div>
      </div>

      <div className="absolute bottom-8 right-8 text-right">
        <p className="text-[10px] uppercase tracking-widest opacity-30 mb-1">Languages</p>
        <p className="text-xs font-mono opacity-50">EN / FR / PT-BR</p>
      </div>
    </div>
  );
}
