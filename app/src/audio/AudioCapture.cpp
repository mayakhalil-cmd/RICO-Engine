#include "src/ui/tabs/UICommon.h"
#include "miniaudio.h"

#include <mutex>

static ma_device g_audioDevice;
static ma_device_config g_audioConfig;

// Raw sound for the interface's audio lab: 16-bit stereo, taken out by the
// web bridge a few dozen times a second.
static std::mutex g_pcmMutex;
static std::vector<int16_t> g_pcmPending;
static bool g_pcmOn = false;
static int g_pcmRate = 48000;

void AudioPcm_Enable(bool on) {
    std::lock_guard<std::mutex> lock(g_pcmMutex);
    g_pcmOn = on;
    g_pcmPending.clear();
}

size_t AudioPcm_Take(std::vector<int16_t>& out, int& rate) {
    std::lock_guard<std::mutex> lock(g_pcmMutex);
    out.swap(g_pcmPending);
    g_pcmPending.clear();
    rate = g_pcmRate;
    return out.size();
}

AudioAnalyzer* g_audioAnalyzer = nullptr;

// Enumerate available audio input devices
void EnumerateAudioDevices() {
    g_audioState.deviceNames.clear();
    g_audioState.deviceNames.push_back("System Default (Loopback)");

    ma_context context;
    if (ma_context_init(NULL, 0, NULL, &context) != MA_SUCCESS) {
        return;
    }

    ma_device_info* pPlaybackInfos;
    ma_uint32 playbackCount;
    ma_device_info* pCaptureInfos;
    ma_uint32 captureCount;

    if (ma_context_get_devices(&context, &pPlaybackInfos, &playbackCount, &pCaptureInfos, &captureCount) != MA_SUCCESS) {
        ma_context_uninit(&context);
        return;
    }

    // Add capture devices (microphones, line-ins, audio interfaces)
    for (ma_uint32 i = 0; i < captureCount; i++) {
        g_audioState.deviceNames.push_back(std::string(pCaptureInfos[i].name));
    }

    ma_context_uninit(&context);
}

void AudioCaptureCallback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount) {
    if (!pInput) return;

    const float* samples = (const float*)pInput;

    {
        std::lock_guard<std::mutex> lock(g_pcmMutex);
        if (g_pcmOn) {
            // Keep at most about one second, in case nobody takes it.
            if (g_pcmPending.size() > (size_t)g_pcmRate * 2) g_pcmPending.clear();
            for (ma_uint32 i = 0; i < frameCount * 2; i++) {
                float v = samples[i];
                v = v > 1.0f ? 1.0f : (v < -1.0f ? -1.0f : v);
                g_pcmPending.push_back((int16_t)(v * 32767.0f));
            }
        }
    }

    static float peakLevel = 0.01f;
    static float dcOffset = 0.0f;  // Remove DC bias

    for (ma_uint32 i = 0; i < frameCount; i++) {
        float mono = (samples[i * 2] + samples[i * 2 + 1]) * 0.5f;

        // 1. Remove DC offset (guitar pickups can have DC bias)
        dcOffset = dcOffset * 0.999f + mono * 0.001f;
        mono -= dcOffset;
        mono *= g_guitarState.inputGain;

        // 2. Noise gate (kill very quiet signals)
        if (fabsf(mono) < g_guitarState.noiseGate) {
            mono = 0.0f;
        }

        // 3. Auto-normalize to prevent clipping
        float absVal = fabsf(mono);
        if (absVal > peakLevel) {
            peakLevel = absVal * 1.01f;
        }
        else {
            peakLevel *= 0.9995f; // Very slow decay
        }

        // Normalize if signal is hot
        if (peakLevel > 1.0f) {
            mono = mono / peakLevel * 0.9f;
        }

        // Hard limiter
        mono = SafeClamp(mono, -1.0f, 1.0f);

        // Process for audio analyzer
        if (g_audioAnalyzer) {
            g_audioAnalyzer->ProcessAudioSample(mono);
        }

        // Process for guitar-to-MIDI with emphasis on fundamentals
        if (g_guitarState.enabled && g_guitarSystem) {
            g_guitarSystem->ProcessAudioSample(mono * 1.5f);
        }
    }
}

// Initialize system audio capture
bool StartAudioCapture() {
    return StartAudioCaptureDevice(0);
}

// device 0 = what the computer plays (loopback); 1, 2... = the inputs in
// g_audioState.deviceNames (microphones, line-ins, audio interfaces).
bool StartAudioCaptureDevice(int device) {
    if (g_audioState.capturing) {
        if (device == g_audioState.selectedDevice || (device <= 0 && g_audioState.selectedDevice <= 0)) return true;
        StopAudioCapture();
    }

    static ma_context s_context;
    static bool s_contextReady = false;
    if (!s_contextReady) s_contextReady = ma_context_init(NULL, 0, NULL, &s_context) == MA_SUCCESS;

    ma_device_id captureId;
    bool useCapture = false;
    std::string captureName;
    if (device > 0 && s_contextReady) {
        ma_device_info* pPlaybackInfos; ma_uint32 playbackCount;
        ma_device_info* pCaptureInfos; ma_uint32 captureCount;
        if (ma_context_get_devices(&s_context, &pPlaybackInfos, &playbackCount, &pCaptureInfos, &captureCount) == MA_SUCCESS
            && (ma_uint32)(device - 1) < captureCount) {
            captureId = pCaptureInfos[device - 1].id;
            captureName = pCaptureInfos[device - 1].name;
            useCapture = true;
        }
    }

    g_audioAnalyzer = new AudioAnalyzer();
    g_audioConfig = ma_device_config_init(useCapture ? ma_device_type_capture : ma_device_type_loopback);
    if (useCapture) {
        g_audioConfig.capture.pDeviceID = &captureId;
        g_audioConfig.capture.format = ma_format_f32;
        g_audioConfig.capture.channels = 2;
    } else {
        g_audioConfig.playback.format = ma_format_f32;
        g_audioConfig.playback.channels = 2;
    }
    g_audioConfig.sampleRate = 48000;
    g_audioConfig.dataCallback = AudioCaptureCallback;
    g_audioConfig.periodSizeInFrames = 256;
    g_audioConfig.periods = 2;
    g_pcmRate = 48000;

    g_audioState.currentDeviceName = useCapture ? captureName : "System Audio (Loopback)";
    g_audioState.selectedDevice = useCapture ? device : 0;

    if (ma_device_init(s_contextReady ? &s_context : NULL, &g_audioConfig, &g_audioDevice) != MA_SUCCESS) {
        delete g_audioAnalyzer;
        g_audioAnalyzer = nullptr;
        return false;
    }

    if (ma_device_start(&g_audioDevice) != MA_SUCCESS) {
        ma_device_uninit(&g_audioDevice);
        delete g_audioAnalyzer;
        g_audioAnalyzer = nullptr;
        return false;
    }

    g_audioState.capturing = true;
    return true;
}


void StopAudioCapture() {
    if (g_audioState.capturing) {
        ma_device_uninit(&g_audioDevice);
        delete g_audioAnalyzer;
        g_audioAnalyzer = nullptr;
        g_audioState.capturing = false;
    }
}

void TickModulationChannels() {
    auto now = std::chrono::steady_clock::now();
    static auto lastTick = now;
    float dt = std::chrono::duration<float>(now - lastTick).count();
    lastTick = now;
    dt = SafeClamp(dt, 0.0001f, 0.1f);

    for (auto& lfo : g_lfoChannels) {
        if (!lfo.enabled) continue;
        float bpm = lfo.manualBPM;
        float rate = lfo.bpmSync ? (bpm / 60.0f * lfo.bpmMult) : lfo.rateHz;
        lfo.phase += rate * dt;
        if (lfo.phase > 1.0f) lfo.phase -= 1.0f;
        float raw = 0.0f;
        switch (lfo.shape) {
        case LFOShape::Sine:     raw = sinf(lfo.phase * 2.0f * (float)M_PI); break;
        case LFOShape::Square:   raw = lfo.phase < 0.5f ? 1.0f : -1.0f; break;
        case LFOShape::Saw:      raw = lfo.phase * 2.0f - 1.0f; break;
        case LFOShape::Triangle: raw = (lfo.phase < 0.5f) ? (lfo.phase * 4.0f - 1.0f) : (3.0f - lfo.phase * 4.0f); break;
        case LFOShape::Noise:    raw = ((float)rand() / RAND_MAX) * 2.0f - 1.0f; break;
        case LFOShape::Custom: {
            int step = (int)(lfo.phase * lfo.customStepCount) % lfo.customStepCount;
            if (lfo.stepEnabled[step])
                raw = lfo.customSteps[step] * 2.0f - 1.0f;
            else
                raw = -1.0f;  // skipped step = output 0
            break;
        }
        }
        lfo.value = SafeClamp((raw * lfo.amplitude + 1.0f) * 0.5f, 0.0f, 1.0f);

        if (!lfo.oscEnabled) continue;
        try {
            float val = SafeClamp(lfo.value * lfo.multiplier, 0.0f, 1.0f);
            char buffer[1024];
            osc::OutboundPacketStream p(buffer, 1024);
            p << osc::BeginMessage(lfo.oscAddress) << val << osc::EndMessage;
            UdpTransmitSocket socket(IpEndpointName(lfo.oscIP, lfo.oscPort));
            socket.Send(p.Data(), p.Size());
        }
        catch (...) {}
    }

    for (auto& pulse : g_pulseChannels) {
        if (!pulse.enabled) continue;
        pulse.Tick();
        if (!pulse.oscEnabled) continue;
        try {
            float val = SafeClamp(pulse.value * pulse.multiplier, 0.0f, 1.0f);
            char buffer[1024];
            osc::OutboundPacketStream p(buffer, 1024);
            p << osc::BeginMessage(pulse.oscAddress) << val << osc::EndMessage;
            UdpTransmitSocket socket(IpEndpointName(pulse.oscIP, pulse.oscPort));
            socket.Send(p.Data(), p.Size());
        }
        catch (...) {}
    }
}

// Route audio bands to displays using user-defined mappings
void ProcessAudioToDisplays() {
    if (!g_audioAnalyzer) return;
    TickModulationChannels();

    AudioBands bands = g_audioAnalyzer->GetBands();    // UI/OSC (smoothed)
    AudioBands led = g_audioAnalyzer->GetLEDBands();   // LED serial (fast, low latency)

    // FREQUENCY-BASED BRIGHTNESS CALCULATION
    float brightnessMult = 1.0f;
    if (g_ledState.freqBrightness && g_ledState.connected) {
        // Calculate dominant frequency intensity
        // High frequencies (500Hz+) = bright, Low frequencies = dim
        float highFreqRatio = (led.mid * 0.3f + led.high * 0.7f); // Weight toward highs

        if (highFreqRatio > 0.4f) {
            // High frequency dominant - use bright multiplier
            brightnessMult = g_ledState.brightnessAboveThreshold;
        }
        else {
            // Low frequency dominant - use dim multiplier
            brightnessMult = g_ledState.brightnessBelowThreshold;
        }

        // Smooth transition
        static float smoothBrightness = 1.0f;
        smoothBrightness = smoothBrightness * 0.7f + brightnessMult * 0.3f;
        brightnessMult = smoothBrightness;
    }

    // SEND AUDIO DATA TO LED STRIP
    if (g_ledState.connected && g_ledState.audioReactive) {
        // Apply gains
        float lowProcessed = led.low * g_ledState.lowGain;
        float midProcessed = led.mid * g_ledState.midGain;
        float highProcessed = led.high * g_ledState.highGain;

        // Apply noise floor
        if (lowProcessed < g_ledState.noiseFloor) lowProcessed = 0.0f;
        if (midProcessed < g_ledState.noiseFloor) midProcessed = 0.0f;
        if (highProcessed < g_ledState.noiseFloor) highProcessed = 0.0f;

        // Clamp to valid range
        lowProcessed = SafeClamp(lowProcessed, 0.0f, 1.0f);
        midProcessed = SafeClamp(midProcessed, 0.0f, 1.0f);
        highProcessed = SafeClamp(highProcessed, 0.0f, 1.0f);

        // Apply frequency-based brightness multiplier
        lowProcessed *= brightnessMult;
        midProcessed *= brightnessMult;
        highProcessed *= brightnessMult;

        // Send to LED strip
        g_ledStrip.SendAudioData(lowProcessed, midProcessed, highProcessed);

        // PATTERN-SPECIFIC COLOR UPDATES (CACHED - only send when changed)
        static int lastPattern = -1;
        static int lastAudioBarsR = -1, lastAudioBarsG = -1, lastAudioBarsB = -1;
        static int lastSparkR = -1, lastSparkG = -1, lastSparkB = -1;

        bool patternChanged = (g_ledState.currentPattern != lastPattern);

        if (g_ledState.currentPattern == 6) {
            // Audio Bars - send custom color via MAPLOW command (ONLY IF CHANGED)
            if (patternChanged ||
                lastAudioBarsR != g_ledState.audioBarsColor.r ||
                lastAudioBarsG != g_ledState.audioBarsColor.g ||
                lastAudioBarsB != g_ledState.audioBarsColor.b) {

                char cmd[64];
                sprintf_s(cmd, "MAPLOW:%d,%d,%d", g_ledState.audioBarsColor.r, g_ledState.audioBarsColor.g, g_ledState.audioBarsColor.b);
                g_ledStrip.SendCommand(cmd);

                lastAudioBarsR = g_ledState.audioBarsColor.r;
                lastAudioBarsG = g_ledState.audioBarsColor.g;
                lastAudioBarsB = g_ledState.audioBarsColor.b;
            }
        }
        else if (g_ledState.currentPattern == 11) {
            // Audio Bars + Spark Combo - send both colors (ONLY IF CHANGED)
            bool colorsChanged = (lastAudioBarsR != g_ledState.audioBarsColor.r ||
                lastAudioBarsG != g_ledState.audioBarsColor.g ||
                lastAudioBarsB != g_ledState.audioBarsColor.b ||
                lastSparkR != g_ledState.sparkColor.r ||
                lastSparkG != g_ledState.sparkColor.g ||
                lastSparkB != g_ledState.sparkColor.b);

            if (patternChanged || colorsChanged) {
                // Send bass color
                char cmd1[64];
                sprintf_s(cmd1, "MAPLOW:%d,%d,%d", g_ledState.audioBarsColor.r, g_ledState.audioBarsColor.g, g_ledState.audioBarsColor.b);
                g_ledStrip.SendCommand(cmd1);

                // Send spark color (use MAPHIGH for spark)
                char cmd2[64];
                sprintf_s(cmd2, "MAPHIGH:%d,%d,%d", g_ledState.sparkColor.r, g_ledState.sparkColor.g, g_ledState.sparkColor.b);
                g_ledStrip.SendCommand(cmd2);

                lastAudioBarsR = g_ledState.audioBarsColor.r;
                lastAudioBarsG = g_ledState.audioBarsColor.g;
                lastAudioBarsB = g_ledState.audioBarsColor.b;
                lastSparkR = g_ledState.sparkColor.r;
                lastSparkG = g_ledState.sparkColor.g;
                lastSparkB = g_ledState.sparkColor.b;
            }
        }
        else if (g_ledState.currentPattern == 3) {
            // Sparkle effect - send spark color via COLOR command (ONLY IF CHANGED)
            if (patternChanged ||
                lastSparkR != g_ledState.sparkColor.r ||
                lastSparkG != g_ledState.sparkColor.g ||
                lastSparkB != g_ledState.sparkColor.b) {

                g_ledStrip.SetColor(g_ledState.sparkColor.r, g_ledState.sparkColor.g, g_ledState.sparkColor.b);

                lastSparkR = g_ledState.sparkColor.r;
                lastSparkG = g_ledState.sparkColor.g;
                lastSparkB = g_ledState.sparkColor.b;
            }
        }

        lastPattern = g_ledState.currentPattern;
    }

    // SEND TO OSC MAPPINGS
    for (const auto& mapping : g_audioBandMappings) {
        if (!mapping.enabled) continue;

        float value = 0.0f;
        switch (mapping.bandType) {
        case 0:  value = bands.low;        break;
        case 1:  value = bands.mid;        break;
        case 2:  value = bands.high;       break;
        case 3:  value = bands.overall;    break;
        case 4:  value = bands.sub;        break;
        case 5:  value = bands.kick;       break;
        case 6:  value = bands.snare;      break;
        case 7:  value = bands.midrange;   break;
        case 8:  value = bands.presence;   break;
        case 9:  value = bands.air;        break;
        case 10: value = bands.kickOnset;  break;
        case 11: value = bands.snareOnset; break;
        case 12: value = bands.midOnset;   break;
            // LFO channels (13-16)
        case 13: value = (g_lfoChannels.size() > 0) ? g_lfoChannels[0].value : 0.0f; break;
        case 14: value = (g_lfoChannels.size() > 1) ? g_lfoChannels[1].value : 0.0f; break;
        case 15: value = (g_lfoChannels.size() > 2) ? g_lfoChannels[2].value : 0.0f; break;
        case 16: value = (g_lfoChannels.size() > 3) ? g_lfoChannels[3].value : 0.0f; break;
            // Pulse channels (17-20)
        case 17: value = (g_pulseChannels.size() > 0) ? g_pulseChannels[0].value : 0.0f; break;
        case 18: value = (g_pulseChannels.size() > 1) ? g_pulseChannels[1].value : 0.0f; break;
        case 19: value = (g_pulseChannels.size() > 2) ? g_pulseChannels[2].value : 0.0f; break;
        case 20: value = (g_pulseChannels.size() > 3) ? g_pulseChannels[3].value : 0.0f; break;
        }

        value *= mapping.multiplier;
        value = SafeClamp(value, 0.0f, 1.0f);

        try {
            char buffer[1024];
            osc::OutboundPacketStream p(buffer, 1024);
            p << osc::BeginMessage(mapping.oscAddress.c_str()) << value << osc::EndMessage;
            UdpTransmitSocket socket(IpEndpointName(mapping.ip.c_str(), mapping.port));
            socket.Send(p.Data(), p.Size());
        }
        catch (std::exception&) {
            // Silently fail to avoid spam
        }
    }


    // LIVE AFTER EFFECTS EXPORT
    if (g_aeRecState.liveExport && g_audioAnalyzer) {
        AudioBands bands = g_audioAnalyzer->GetBands();

        std::ofstream file(g_aeRecState.livePath);
        file << "var audioData = {\n";
        file << "  audioLow: " << bands.low << ",\n";
        file << "  audioMid: " << bands.mid << ",\n";
        file << "  audioHigh: " << bands.high << ",\n";
        file << "  overall: " << bands.overall << ",\n";
        file << "  timestamp: " << std::time(nullptr) << "\n";
        file << "};\n";
        file.close();
    }
    // KEYFRAME RECORDING
    if (g_aeRecState.active && g_audioAnalyzer) {
        RecordAEKeyframe();
    }
}

