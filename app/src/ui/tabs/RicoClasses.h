#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <string>
#include <vector>
#include <set>
#include <mutex>
#include <algorithm>
#include <cmath>
#include <cstring>

#include "RtMidi.h"
#include "pffft.h"
#include "src/common/Utils.h"
#include "src/ui/tabs/RicoTypes.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

class SerialController {
protected:
    HANDLE serialHandle;
    bool connected;
    std::string portName;
    DWORD baudRate;

public:
    SerialController(DWORD baud = CBR_9600)
        : serialHandle(INVALID_HANDLE_VALUE), connected(false), portName("COM3"), baudRate(baud) {
    }

    virtual ~SerialController() {
        Disconnect();
    }

    bool Connect(const std::string& port, DWORD baud = 0) {
        if (baud > 0) baudRate = baud;
        portName = port;

        serialHandle = CreateFileA(
            portName.c_str(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            NULL,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            NULL
        );

        if (serialHandle == INVALID_HANDLE_VALUE) {
            connected = false;
            return false;
        }

        DCB dcbSerialParams = { 0 };
        dcbSerialParams.DCBlength = sizeof(dcbSerialParams);

        if (!GetCommState(serialHandle, &dcbSerialParams)) {
            CloseHandle(serialHandle);
            connected = false;
            return false;
        }

        dcbSerialParams.BaudRate = baudRate;
        dcbSerialParams.ByteSize = 8;
        dcbSerialParams.StopBits = ONESTOPBIT;
        dcbSerialParams.Parity = NOPARITY;

        if (!SetCommState(serialHandle, &dcbSerialParams)) {
            CloseHandle(serialHandle);
            connected = false;
            return false;
        }

        COMMTIMEOUTS timeouts = { 0 };
        timeouts.ReadIntervalTimeout = 50;
        timeouts.ReadTotalTimeoutConstant = 50;
        timeouts.ReadTotalTimeoutMultiplier = 10;
        timeouts.WriteTotalTimeoutConstant = 50;
        timeouts.WriteTotalTimeoutMultiplier = 10;
        SetCommTimeouts(serialHandle, &timeouts);

        connected = true;
        return true;
    }

    void Disconnect() {
        if (serialHandle != INVALID_HANDLE_VALUE) {
            CloseHandle(serialHandle);
            serialHandle = INVALID_HANDLE_VALUE;
        }
        connected = false;
    }

    bool SendCommand(const std::string& command) {
        if (!connected || serialHandle == INVALID_HANDLE_VALUE) return false;

        DWORD bytesWritten;
        std::string fullCommand = command + "\n";

        bool success = WriteFile(
            serialHandle,
            fullCommand.c_str(),
            static_cast<DWORD>(fullCommand.length()),
            &bytesWritten,
            NULL
        );

        FlushFileBuffers(serialHandle);
        return success;
    }

    bool IsConnected() const { return connected; }
    std::string GetPortName() const { return portName; }
};

// LED Strip Controller for WS2811 via Raspberry Pi Pico ===
class LEDStripController : public SerialController {
private:
    int numLEDs;
    float brightness;
    int currentPattern;

public:
    LEDStripController() : SerialController(CBR_115200), numLEDs(300), brightness(1.0f), currentPattern(0) {}

    bool Connect(const std::string& port) {
        return SerialController::Connect(port, CBR_115200);
    }

    bool SetNumLEDs(int count) {
        numLEDs = count;
        return SendCommand(std::string("LEDS:") + std::to_string(count));
    }


    bool SetBrightness(float b) {
        brightness = SafeClamp<float>(b, 0.0f, 1.0f);
        int value = static_cast<int>(brightness * 255.0f);
        return SendCommand(std::string("BRIGHT:") + std::to_string(value));
    }


    bool SetPattern(int patternId) {
        currentPattern = patternId;
        return SendCommand(std::string("PATTERN:") + std::to_string(patternId));
    }

    bool SendAudioData(float low, float mid, float high) {
        int iLow = static_cast<int>(SafeClamp<float>(low, 0.0f, 1.0f) * 255.0f);
        int iMid = static_cast<int>(SafeClamp<float>(mid, 0.0f, 1.0f) * 255.0f);
        int iHigh = static_cast<int>(SafeClamp<float>(high, 0.0f, 1.0f) * 255.0f);

        return SendCommand(std::string("AUDIO:") +
            std::to_string(iLow) + "," +
            std::to_string(iMid) + "," +
            std::to_string(iHigh));
    }


    bool SetColor(int r, int g, int b) {
        return SendCommand(std::string("COLOR:") +
            std::to_string(r) + "," +
            std::to_string(g) + "," +
            std::to_string(b));
    }


    bool SetSpeed(float speed) {
        float clampedF = SafeClamp<float>(speed, 0.1f, 5.0f);
        int value = static_cast<int>(clampedF * 100.0f);
        return SendCommand(std::string("SPEED:") + std::to_string(value));
    }


    bool SetReactivity(int strength) {
        int clamped = SafeClamp<int>(strength, 0, 100);
        return SendCommand(std::string("REACT:") + std::to_string(clamped));
    }

    bool Stop() {
        return SendCommand("STOP");
    }

    int GetNumLEDs() const { return numLEDs; }
    float GetBrightness() const { return brightness; }
    int GetCurrentPattern() const { return currentPattern; }
};


extern LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

// ===== GUITAR-TO-MIDI SYSTEM :-) =====
// Monophonic pitch detector using YIN algorithm
class MonophonicDetector {
private:
    static const int BUFFER_SIZE = 4096;
    static const int SAMPLE_RATE = 48000;
    float audioBuffer[BUFFER_SIZE];
    int bufferPos = 0;

    float lastDetectedFreq = 0.0f;
    int lastMidiNote = -1;
    float confidenceThreshold = 0.08f;  // sensitivity controller

    float YINPitchDetection() {
        float tau[BUFFER_SIZE / 2];

        // Step 1: Difference function
        for (int j = 0; j < BUFFER_SIZE / 2; j++) {
            float diff = 0.0f;
            for (int i = 0; i < BUFFER_SIZE / 2; i++) {
                float delta = audioBuffer[i] - audioBuffer[i + j];
                diff += delta * delta;
            }
            tau[j] = diff;
        }

        // Step 2: Cumulative mean normalized difference
        tau[0] = 1.0f;
        float runningSum = 0.0f;
        for (int j = 1; j < BUFFER_SIZE / 2; j++) {
            runningSum += tau[j];
            tau[j] *= j / runningSum;
        }

        // Step 3: Absolute threshold
        int period = -1;
        for (int j = 2; j < BUFFER_SIZE / 2; j++) {
            if (tau[j] < confidenceThreshold) {
                period = j;
                break;
            }
        }

        if (period == -1) return 0.0f;

        // Step 4: Parabolic interpolation for better accuracy
        float betterPeriod = static_cast<float>(period);
        if (period > 0 && period < BUFFER_SIZE / 2 - 1) {
            float s0 = tau[period - 1];
            float s1 = tau[period];
            float s2 = tau[period + 1];
            betterPeriod = period + (s2 - s0) / (2.0f * (2.0f * s1 - s2 - s0));
        }

        return SAMPLE_RATE / betterPeriod;
    }

    int FrequencyToMidiNote(float freq) {
        if (freq < 20.0f) return -1;
        return (int)roundf(12.0f * log2f(freq / 440.0f) + 69.0f);
    }

public:
    void ProcessSample(float sample) {
        audioBuffer[bufferPos++] = sample;
        if (bufferPos >= BUFFER_SIZE) {
            bufferPos = 0;
        }
    }

    bool DetectPitch(float& outFreq, int& outMidiNote, float& outConfidence) {
        float freq = YINPitchDetection();

        if (freq > 0.0f) {
            int midiNote = FrequencyToMidiNote(freq);

            // Filter to guitar range (E2=40 to E6=88)
            if (midiNote >= 40 && midiNote <= 88) {
                outFreq = freq;
                outMidiNote = midiNote;
                outConfidence = 1.0f - confidenceThreshold;

                lastDetectedFreq = freq;
                lastMidiNote = midiNote;
                return true;
            }
        }

        return false;
    }

    void SetSensitivity(float sensitivity) {
        confidenceThreshold = 0.03f + (1.0f - sensitivity) * 0.12f;  // Lower range
    }
};

// Polyphonic pitch detector using FFT + Harmonic Product Spectrum
class PolyphonicDetector {
private:
    static const int FFT_SIZE = 4096;
    static const int SAMPLE_RATE = 48000;
    static const int MAX_NOTES = 6;

    float fftInput[FFT_SIZE];
    float fftMagnitude[FFT_SIZE / 2];
    float hanningWindow[FFT_SIZE];
    int bufferPos = 0;

    struct DetectedNote {
        float frequency;
        int midiNote;
        float magnitude;
        bool active;
    };

    DetectedNote activeNotes[MAX_NOTES];
    float noteStabilityTime[128]; // Temporal smoothing

    void InitializeWindow() {
        for (int i = 0; i < FFT_SIZE; i++) {
            hanningWindow[i] = 0.5f * (1.0f - cosf(2.0f * (float)M_PI * i / (FFT_SIZE - 1)));
        }
    }

    void PerformFFT() {
        float windowed[FFT_SIZE];
        for (int i = 0; i < FFT_SIZE; i++) {
            windowed[i] = fftInput[i] * hanningWindow[i];
        }

        for (int k = 0; k < FFT_SIZE / 2; k++) {
            float real = 0.0f, imag = 0.0f;
            for (int n = 0; n < FFT_SIZE; n++) {
                float angle = 2.0f * (float)M_PI * k * n / FFT_SIZE;
                real += windowed[n] * cosf(angle);
                imag += windowed[n] * sinf(angle);
            }
            fftMagnitude[k] = sqrtf(real * real + imag * imag);
        }
    }

    float HarmonicProductSpectrum(int binStart, int binEnd) {
        float hps[FFT_SIZE / 2] = { 0 };

        // Copy magnitude spectrum
        for (int i = binStart; i < binEnd; i++) {
            hps[i] = fftMagnitude[i];
        }

        // Multiply by downsampled harmonics (2x, 3x, 4x)
        for (int harmonic = 2; harmonic <= 4; harmonic++) {
            for (int i = binStart; i < binEnd / harmonic; i++) {
                hps[i] *= fftMagnitude[i * harmonic];
            }
        }

        // Find peak
        float maxVal = 0.0f;
        int maxBin = -1;
        for (int i = binStart; i < binEnd; i++) {
            if (hps[i] > maxVal) {
                maxVal = hps[i];
                maxBin = i;
            }
        }

        if (maxBin == -1) return 0.0f;
        return (float)maxBin * SAMPLE_RATE / FFT_SIZE;
    }

    int FrequencyToMidiNote(float freq) {
        if (freq < 20.0f) return -1;
        return (int)roundf(12.0f * log2f(freq / 440.0f) + 69.0f);
    }

    bool IsHarmonic(float freq1, float freq2) {
        if (freq1 <= 0 || freq2 <= 0) return false;
        float ratio = freq2 / freq1;
        // Check if ratio is close to 2, 3, 4, etc.
        float nearestInteger = roundf(ratio);
        return fabsf(ratio - nearestInteger) < 0.15f;
    }

public:
    PolyphonicDetector() {
        InitializeWindow();
        std::fill(fftInput, fftInput + FFT_SIZE, 0.0f);
        std::fill(noteStabilityTime, noteStabilityTime + 128, 0.0f);
        for (int i = 0; i < MAX_NOTES; i++) {
            activeNotes[i].active = false;
        }
    }

    void ProcessSample(float sample) {
        fftInput[bufferPos++] = sample;
        if (bufferPos >= FFT_SIZE) {
            bufferPos = 0;
        }
    }

    int DetectChord(int outMidiNotes[MAX_NOTES], float outMagnitudes[MAX_NOTES]) {
        PerformFFT();

        // Find peaks in guitar range (80Hz to 1200Hz)
        int binStart = (int)(80.0f * FFT_SIZE / SAMPLE_RATE);
        int binEnd = (int)(1200.0f * FFT_SIZE / SAMPLE_RATE);

        std::vector<std::pair<float, int>> candidates; // <magnitude, bin>

        // Peak detection with local maxima ===
        for (int i = binStart + 2; i < binEnd - 2; i++) {
            if (fftMagnitude[i] > fftMagnitude[i - 1] &&
                fftMagnitude[i] > fftMagnitude[i + 1] &&
                fftMagnitude[i] > fftMagnitude[i - 2] &&
                fftMagnitude[i] > fftMagnitude[i + 2]) {

                float freq = (float)i * SAMPLE_RATE / FFT_SIZE;
                int midiNote = FrequencyToMidiNote(freq);

                if (midiNote >= 38 && midiNote <= 96) {
                    candidates.push_back({ fftMagnitude[i], i });
                }
            }
        }

        // Sort by magnitude
        std::sort(candidates.begin(), candidates.end(),
            [](const auto& a, const auto& b) { return a.first > b.first; });

        // Filter harmonics and select top notes
        std::vector<std::pair<float, int>> filtered;
        for (const auto& cand : candidates) {
            float freq = (float)cand.second * SAMPLE_RATE / FFT_SIZE;

            bool isHarmonicOfExisting = false;
            for (const auto& existing : filtered) {
                float existingFreq = (float)existing.second * SAMPLE_RATE / FFT_SIZE;
                if (IsHarmonic(existingFreq, freq)) {
                    isHarmonicOfExisting = true;
                    break;
                }
            }

            if (!isHarmonicOfExisting) {
                filtered.push_back(cand);
                if (filtered.size() >= MAX_NOTES) break;
            }
        }

        // Apply temporal smoothing
        float currentTime = GetTickCount() / 1000.0f;

        for (size_t i = 0; i < filtered.size(); i++) {
            float freq = (float)filtered[i].second * SAMPLE_RATE / FFT_SIZE;
            int midiNote = FrequencyToMidiNote(freq);

            noteStabilityTime[midiNote] = currentTime;
            outMidiNotes[i] = midiNote;
            outMagnitudes[i] = filtered[i].first;
        }

        // Remove notes that haven't been detected recently
        for (int n = 0; n < 128; n++) {
            if (currentTime - noteStabilityTime[n] > 0.1f) {
                noteStabilityTime[n] = 0.0f;
            }
        }

        return (int)filtered.size();
    }
};

// Simple guitar-to-MIDI system
class SimpleGuitarSystem {
private:
    MonophonicDetector monophonic;
    PolyphonicDetector polyphonic;

    bool usePolyphonic = false;
    int midiChannel = 1;
    int baseVelocity = 100;
    float sensitivity = 0.7f;
    bool sendPitchBend = false;

    std::set<int> currentNotes;
    std::mutex notesMutex;

    RtMidiOut* midiOut = nullptr;

public:
    void SetMidiOut(RtMidiOut* out) { midiOut = out; }
    void SetPolyphonic(bool poly) { usePolyphonic = poly; }
    void SetMidiChannel(int ch) { midiChannel = SafeClamp(ch, 1, 16); }
    void SetVelocity(int vel) { baseVelocity = SafeClamp(vel, 1, 127); }
    void SetSensitivity(float sens) {
        sensitivity = SafeClamp(sens, 0.0f, 1.0f);
        monophonic.SetSensitivity(sensitivity);
    }
    void SetPitchBend(bool enable) { sendPitchBend = enable; }

    bool IsPolyphonic() const { return usePolyphonic; }
    int GetActiveNoteCount() const {
        std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(notesMutex));
        return (int)currentNotes.size();
    }

    void ProcessAudioSample(float sample) {
        if (usePolyphonic) {
            polyphonic.ProcessSample(sample);
        }
        else {
            monophonic.ProcessSample(sample);
        }
    }

    void ProcessFrame() {
        if (!midiOut || !midiOut->isPortOpen()) return;

        if (usePolyphonic) {
            ProcessPolyphonic();
        }
        else {
            ProcessMonophonic();
        }
    }

private:
    void ProcessMonophonic() {
        float freq;
        int midiNote;
        float confidence;

        if (monophonic.DetectPitch(freq, midiNote, confidence)) {
            std::lock_guard<std::mutex> lock(notesMutex);

            // Note off for previous notes
            for (int note : currentNotes) {
                if (note != midiNote) {
                    std::vector<unsigned char> noteOff = {
                        (unsigned char)(0x80 + midiChannel - 1),
                        (unsigned char)note,
                        0
                    };
                    midiOut->sendMessage(&noteOff);
                }
            }

            // Note on for new note if not already playing
            if (currentNotes.find(midiNote) == currentNotes.end()) {
                std::vector<unsigned char> noteOn = {
                    (unsigned char)(0x90 + midiChannel - 1),
                    (unsigned char)midiNote,
                    (unsigned char)baseVelocity
                };
                midiOut->sendMessage(&noteOn);
                currentNotes.clear();
                currentNotes.insert(midiNote);
            }

            // Optional pitch bend for fine tuning
            if (sendPitchBend) {
                float expectedFreq = 440.0f * powf(2.0f, (midiNote - 69) / 12.0f);
                float cents = 1200.0f * log2f(freq / expectedFreq);
                int bendValue = (int)(8192 + cents * 8192.0f / 200.0f); // +/-200 cents range
                bendValue = SafeClamp(bendValue, 0, 16383);

                std::vector<unsigned char> pitchBend = {
                    (unsigned char)(0xE0 + midiChannel - 1),
                    (unsigned char)(bendValue & 0x7F),
                    (unsigned char)((bendValue >> 7) & 0x7F)
                };
                midiOut->sendMessage(&pitchBend);
            }
        }
        else {
            // No pitch detected - send note off for all
            std::lock_guard<std::mutex> lock(notesMutex);
            for (int note : currentNotes) {
                std::vector<unsigned char> noteOff = {
                    (unsigned char)(0x80 + midiChannel - 1),
                    (unsigned char)note,
                    0
                };
                midiOut->sendMessage(&noteOff);
            }
            currentNotes.clear();
        }
    }

    void ProcessPolyphonic() {
        int detectedNotes[6];
        float magnitudes[6];
        int noteCount = polyphonic.DetectChord(detectedNotes, magnitudes);

        std::lock_guard<std::mutex> lock(notesMutex);
        std::set<int> newNotes(detectedNotes, detectedNotes + noteCount);

        // Note off for notes that are no longer detected
        for (int note : currentNotes) {
            if (newNotes.find(note) == newNotes.end()) {
                std::vector<unsigned char> noteOff = {
                    (unsigned char)(0x80 + midiChannel - 1),
                    (unsigned char)note,
                    0
                };
                midiOut->sendMessage(&noteOff);
            }
        }

        // Note on for newly detected notes
        for (int i = 0; i < noteCount; i++) {
            int note = detectedNotes[i];
            if (currentNotes.find(note) == currentNotes.end()) {
                // Scale velocity by magnitude
                int velocity = (int)(baseVelocity * SafeClamp(magnitudes[i] / 100.0f, 0.3f, 1.0f));

                std::vector<unsigned char> noteOn = {
                    (unsigned char)(0x90 + midiChannel - 1),
                    (unsigned char)note,
                    (unsigned char)velocity
                };
                midiOut->sendMessage(&noteOn);
            }
        }

        currentNotes = newNotes;
    }
};

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "ws2_32.lib")

// Forward declarations
bool CreateDeviceD3D(HWND hWnd);
void CleanupDeviceD3D();
void CreateRenderTarget();
void CleanupRenderTarget();
void StopAudioCapture();
bool StartAudioCapture();
void RecordAEKeyframe();
void ExportAEKeyframes();
void SendArtNetDMX();
void RouteArtNetMappings(int midiCC, int midiCh, float normalizedValue);
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

void DrawGuitarMIDITab();
void MidiCallback(double timeStamp, std::vector<unsigned char>* message, void* userData);
void CreateNativeVirtualPorts();
void DestroyNativeVirtualPorts();
void DrawMIDITab();
void DrawOSCTab();
void DrawSpoutTab();
void DrawNetworkVideoTab();
void DrawDMXTab();
void DrawAbletonLinkTab();
void DrawMQTTTab();

void DrawMIDI_DevicesSubTab();
void DrawMIDI_MappingsSubTab();
void DrawOSC_DestinationsSubTab();
void DrawOSC_MappingsSubTab();
void DrawOSC_AudioRoutingSubTab();

void DrawSpout_SendSubTab();
void DrawSpout_AEExportSubTab();
void DrawMultimedia_MultiVoxSubTab();
void DrawMultimedia_LEDStripSubTab();
void DrawMultimedia_AfterEffectsSubTab();
void DrawMultimedia_TimedSequencesSubTab();

class AudioAnalyzer {
private:
    static const int FFT_SIZE = 2048;
    static const int HOP_SIZE = 1024;
    static const int SAMPLE_RATE = 48000;

    PFFFT_Setup* fftSetup = nullptr;
    float* fftInput = nullptr;
    float* fftWork = nullptr;
    float* fftOut = nullptr;
    float        fftMag[FFT_SIZE / 2 + 1] = {};

    float ringBuf[FFT_SIZE] = {};
    int   ringWrite = 0;
    int   hopCount = 0;

    float window[FFT_SIZE] = {};
    float prevMag[FFT_SIZE / 2 + 1] = {};

    struct Band {
        float freqLow, freqHigh;
        float peak = 0.01f;
        float smoothed = 0.0f;
        float ledVal = 0.0f;
        float fluxSmooth = 0.0f;
        float onset = 0.0f;
        float ledDecay = 0.88f;
        float smoothing = 0.70f;  // per-band override
    };

    Band bands[6] = {
        { 20.f,   80.f   },  // 0 sub
        { 60.f,   130.f  },  // 1 kick
        { 150.f,  500.f  },  // 2 snare
        { 500.f,  3000.f },  // 3 midrange
        { 3000.f, 8000.f },  // 4 presence
        { 8000.f, 18000.f},  // 5 air
    };

    AudioBands smoothedBands;
    AudioBands ledBands;
    std::mutex bandsMutex;
    float      masterSmoothing = 0.70f;

    inline int freqToBin(float hz) const {
        int b = (int)(hz * FFT_SIZE / SAMPLE_RATE);
        return SafeClamp(b, 0, FFT_SIZE / 2);
    }

    float bandEnergy(const Band& b) {
        int lo = freqToBin(b.freqLow);
        int hi = freqToBin(b.freqHigh);
        if (lo >= hi) return 0.0f;
        float sum = 0.0f;
        for (int i = lo; i <= hi; i++) sum += fftMag[i];
        return sum / (float)(hi - lo + 1);
    }

    float spectralFlux(const Band& b) {
        int lo = freqToBin(b.freqLow);
        int hi = freqToBin(b.freqHigh);
        float flux = 0.0f;
        for (int i = lo; i <= hi; i++) {
            if (fftMag[i] < 0.0001f) continue;  // skip silent bins
            float diff = fftMag[i] - prevMag[i];
            if (diff > 0.0f) flux += diff;
        }
        return flux / (float)(hi - lo + 1);
    }

    void computeMagnitudes() {
        float windowed[FFT_SIZE];
        for (int i = 0; i < FFT_SIZE; i++) {
            int idx = (ringWrite - FFT_SIZE + i + FFT_SIZE * 2) % FFT_SIZE;
            windowed[i] = ringBuf[idx] * window[i];
        }
        memcpy(fftInput, windowed, sizeof(float) * FFT_SIZE);
        pffft_transform_ordered(fftSetup, fftInput, fftOut, fftWork, PFFFT_FORWARD);

        fftMag[0] = fabsf(fftOut[0]);
        for (int k = 1; k < FFT_SIZE / 2; k++) {
            float r = fftOut[2 * k];
            float im = fftOut[2 * k + 1];
            fftMag[k] = sqrtf(r * r + im * im);
        }
        fftMag[FFT_SIZE / 2] = fabsf(fftOut[1]);
    }

    void processBands() {
        computeMagnitudes();
        std::lock_guard<std::mutex> lock(bandsMutex);

        for (auto& b : bands) {
            float energy = bandEnergy(b);
            if (energy > b.peak) b.peak = energy;
            else                 b.peak *= 0.9995f;
            float norm = SafeClamp(energy / SafeClamp(b.peak, 0.001f, 1e6f), 0.0f, 1.0f);

            b.smoothed = b.smoothed * b.smoothing + norm * (1.0f - b.smoothing);
            if (b.smoothed < 0.02f) b.smoothed = 0.0f;

            float led = (norm > b.ledVal) ? norm : (b.ledVal * b.ledDecay + norm * (1.0f - b.ledDecay));
            b.ledVal = led;

            float fl = spectralFlux(b);
            b.fluxSmooth = b.fluxSmooth * 0.90f + fl * 0.10f;
            float threshold = b.fluxSmooth * 1.5f + 0.001f;
            if (fl > threshold) {
                float pulse = SafeClamp((fl - threshold) / (threshold + 0.001f), 0.0f, 1.0f);
                if (pulse > b.onset) b.onset = pulse;
            }
        }

        bands[0].onset *= 0.82f;
        bands[1].onset *= 0.82f;
        bands[2].onset *= 0.80f;
        bands[3].onset *= 0.85f;
        bands[4].onset *= 0.85f;
        bands[5].onset *= 0.85f;
        for (auto& b : bands) if (b.onset < 0.005f) b.onset = 0.0f;

        memcpy(prevMag, fftMag, sizeof(float) * (FFT_SIZE / 2 + 1));

        float rms = 0.0f;
        for (int i = 0; i < FFT_SIZE; i++) rms += ringBuf[i] * ringBuf[i];
        float overall = SafeClamp(sqrtf(rms / FFT_SIZE) * 4.0f, 0.0f, 1.0f);

        smoothedBands.low = bands[1].smoothed;
        smoothedBands.mid = bands[3].smoothed;
        smoothedBands.high = bands[4].smoothed;
        smoothedBands.overall = overall;
        smoothedBands.sub = bands[0].smoothed;
        smoothedBands.kick = bands[1].smoothed;
        smoothedBands.snare = bands[2].smoothed;
        smoothedBands.midrange = bands[3].smoothed;
        smoothedBands.presence = bands[4].smoothed;
        smoothedBands.air = bands[5].smoothed;
        smoothedBands.kickOnset = bands[1].onset;
        smoothedBands.snareOnset = bands[2].onset;
        smoothedBands.midOnset = bands[3].onset;

        ledBands.low = bands[1].ledVal;
        ledBands.mid = bands[3].ledVal;
        ledBands.high = bands[4].ledVal;
        ledBands.overall = overall;
        ledBands.sub = bands[0].ledVal;
        ledBands.kick = bands[1].ledVal;
        ledBands.snare = bands[2].ledVal;
        ledBands.midrange = bands[3].ledVal;
        ledBands.presence = bands[4].ledVal;
        ledBands.air = bands[5].ledVal;
    }

public:
    AudioAnalyzer() {
        fftSetup = pffft_new_setup(FFT_SIZE, PFFFT_REAL);
        fftInput = (float*)pffft_aligned_malloc(FFT_SIZE * sizeof(float));
        fftWork = (float*)pffft_aligned_malloc(FFT_SIZE * sizeof(float));
        fftOut = (float*)pffft_aligned_malloc(FFT_SIZE * sizeof(float));
        memset(ringBuf, 0, sizeof(ringBuf));
        memset(prevMag, 0, sizeof(prevMag));
        for (int i = 0; i < FFT_SIZE; i++)
            window[i] = 0.5f * (1.0f - cosf(2.0f * (float)M_PI * i / (FFT_SIZE - 1)));
    }

    ~AudioAnalyzer() {
        if (fftSetup) { pffft_destroy_setup(fftSetup); fftSetup = nullptr; }
        if (fftInput) { pffft_aligned_free(fftInput);  fftInput = nullptr; }
        if (fftWork) { pffft_aligned_free(fftWork);   fftWork = nullptr; }
        if (fftOut) { pffft_aligned_free(fftOut);    fftOut = nullptr; }
    }

    void ProcessAudioSample(float sample) {
        ringBuf[ringWrite % FFT_SIZE] = sample;
        ringWrite++;
        hopCount++;
        if (hopCount >= HOP_SIZE) {
            hopCount = 0;
            processBands();
        }
    }

    AudioBands GetBands() {
        std::lock_guard<std::mutex> lock(bandsMutex);
        return smoothedBands;
    }

    AudioBands GetLEDBands() {
        std::lock_guard<std::mutex> lock(bandsMutex);
        return ledBands;
    }

    void SetSmoothing(float f) { masterSmoothing = SafeClamp(f, 0.0f, 0.99f); }
    void SetLEDSmoothing(float f) {}
    void ResetPeaks() {
        std::lock_guard<std::mutex> lock(bandsMutex);
        for (auto& b : bands) { b.peak = 0.01f; b.fluxSmooth = 0.0f; }
    }
    Band* GetBandArray() { return bands; }
    int   GetBandCount() { return 6; }
    float GetBandEnergySimple(float freqLow, float freqHigh) {
        int lo = freqToBin(freqLow);
        int hi = freqToBin(freqHigh);
        if (lo >= hi) return 0.0f;
        float sum = 0.0f;
        std::lock_guard<std::mutex> lock(bandsMutex);
        for (int i = lo; i <= hi; i++) sum += fftMag[i];
        return SafeClamp((sum / (hi - lo + 1)) * 30.0f, 0.0f, 1.0f);
    }
};