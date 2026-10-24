#pragma once
// RicoTypes.h: shared struct/enum/POD definitions
//
// Rules:
//   - STL headers only (#include <string> etc.)
//   - NO Win32, NO ImGui, NO project headers
//   - Classes with methods (AudioAnalyzer, SimpleGuitarSystem,
// LEDStripController) are forward-declared only; their full
//     definitions live in main.cpp / RicoClasses.h

#include <string>
#include <vector>
#include <map>
#include <chrono>
#include <memory>
#include <mutex>

// Forward-declare the three classes tab files use via pointer
class UdpTransmitSocket;
class AudioAnalyzer;
class SimpleGuitarSystem;
class LEDStripController;

// OSCDestination
struct OSCDestination {
    std::string name;
    std::string ip = "127.0.0.1";
    int         port = 8000;
    bool        enabled = true;
    std::unique_ptr<UdpTransmitSocket> sender;
    bool        connected = false;

    OSCDestination() = default;
    OSCDestination(const std::string& n, const std::string& i, int p, bool e = true)
        : name(n), ip(i), port(p), enabled(e) {
    }

    // Non-copyable (unique_ptr member), movable
    OSCDestination(OSCDestination&&) = default;
    OSCDestination& operator=(OSCDestination&&) = default;
    OSCDestination(const OSCDestination&) = delete;
    OSCDestination& operator=(const OSCDestination&) = delete;
};

// ControlMapping
struct ControlMapping {
    int  controlType = -1;
    int  channel = 1;
    int  controller = -1;
    std::string oscAddress;
    std::string displayName;
    std::string dataType = "Unknown";
    bool isLearning = false;
    float minValue = 0.0f;
    float maxValue = 1.0f;
    bool isMomentary = false;
    bool isActive = false;
    float normalizedValue = 0.0f;
};

// MidiControlType
enum class MidiControlType {
    Note = 0,
    CC = 1,
    PitchBend = 2,
    ProgramChange = 3,
    Aftertouch = 4
};

// OSCPreset
struct OSCPreset {
    std::string name = "Default";
    std::string baseAddress = "/";
    int         port = 8000;
    std::string ip = "127.0.0.1";
    bool        useIndexedAddresses = true;
    std::string description = "Default preset";
    std::string setupInstructions = "No setup required";
    std::string midiConfig = "Standard MIDI";
    std::string oscConfig = "Basic OSC";

    OSCPreset() = default;
    OSCPreset(const std::string& n, const std::string& addr, int p,
        const std::string& i, bool indexed,
        const std::string& desc, const std::string& setup,
        const std::string& midi, const std::string& osc)
        : name(n), baseAddress(addr), port(p), ip(i),
        useIndexedAddresses(indexed), description(desc),
        setupInstructions(setup), midiConfig(midi), oscConfig(osc) {
    }
};

// VirtualMidiPort
// A virtual MIDI port made with Windows MIDI Services. Other apps see it by
// its name. See src/midi/WinMidi.cpp.
struct VirtualMidiPort {
    char name[64] = "RICO Port";
    bool active = false;
};

// AEKeyframeData
struct AEKeyframeData {
    float time = 0.0f;
    float audioLow = 0.0f;
    float audioMid = 0.0f;
    float audioHigh = 0.0f;
    float overall = 0.0f;
    std::map<std::string, float> midiValues;
};

// ArtNetMapping
struct ArtNetMapping {
    std::string name;
    int   dmxChannel = 1;
    int   midiCC = -1;
    int   midiChannel = 1;
    float minVal = 0.f;
    float maxVal = 1.f;
    bool  enabled = true;
    float currentValue = 0.f;
};

// AudioBands
struct AudioBands {
    float low = 0.f, mid = 0.f, high = 0.f, overall = 0.f;
    float sub = 0.f, kick = 0.f, snare = 0.f, midrange = 0.f;
    float presence = 0.f, air = 0.f;
    float kickOnset = 0.f, snareOnset = 0.f, midOnset = 0.f;
};

// AudioBandMapping
struct AudioBandMapping {
    std::string displayName = "Mapping";
    std::string oscAddress = "/audio/param";
    std::string ip = "127.0.0.1";
    int   port = 8000;
    int   bandType = 0;
    bool  enabled = true;
    float multiplier = 1.0f;
};

// LFO
enum class LFOShape { Sine, Square, Saw, Triangle, Noise, Custom };

struct LFOChannel {
    char     name[32] = "LFO";
    LFOShape shape = LFOShape::Sine;
    float    rateHz = 1.0f;
    float    phase = 0.0f;
    float    amplitude = 1.0f;
    float    value = 0.0f;
    bool     enabled = true;
    bool     bpmSync = false;
    float    bpmMult = 1.0f;
    float    manualBPM = 120.0f;
    char     oscAddress[128] = "/lfo/1";
    char     oscIP[64] = "127.0.0.1";
    int      oscPort = 8000;
    bool     oscEnabled = false;
    float    multiplier = 1.0f;
    float    customSteps[16] = { 1,0,0,0,0.5f,0,0,0,1,0,0,0,0.5f,0,0.25f,0 };
    bool     stepEnabled[16] = { 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1 };
    int      customStepCount = 16;
    bool     showEditor = false;
};

// PulseChannel
struct PulseChannel {
    char  name[32] = "Pulse";
    float value = 0.0f;
    float decay = 0.85f;
    bool  enabled = true;
    char  oscAddress[128] = "/pulse/1";
    char  oscIP[64] = "127.0.0.1";
    int   oscPort = 8000;
    bool  oscEnabled = false;
    float multiplier = 1.0f;
    void  Fire() { value = 1.0f; }
    void  Tick() { value *= decay; if (value < 0.001f) value = 0.0f; }
};

// Timed Sequence V2
enum class SeqActionType { OSC = 0, MIDI = 1, DMX = 2, Serial = 3 };

struct SeqAction {
    SeqActionType type = SeqActionType::OSC;
    float triggerTime = 0.0f;
    char  oscAddress[128] = "/seq/trigger";
    char  oscIP[64] = "127.0.0.1";
    int   oscPort = 8000;
    float oscValue = 1.0f;
    int   midiType = 0;
    int   midiChannel = 1;
    int   midiData1 = 60;
    int   midiData2 = 127;
    int   dmxChannel = 1;
    float dmxValue = 1.0f;
    char  serialCommand[128] = "TRIGGER:1";
    int   serialTarget = 0;
    bool  enabled = true;
    char  name[64] = "Action";
};

struct TimedSequenceV2 {
    char name[64] = "New Sequence";
    std::vector<SeqAction> actions;
    bool  loop = false;
    float loopInterval = 4.0f;
    bool  running = false;
    bool  paused = false;
    float elapsed = 0.0f;
    std::chrono::steady_clock::time_point startTime;
    std::chrono::steady_clock::time_point pauseTime;
    float pausedDuration = 0.0f;
    int   loopCount = 0;
    int   maxLoops = 0;
};

// MQTT
struct MQTTMessage {
    std::string topic;
    std::string payload;
    float timestamp = 0.0f;
};

struct MQTTSubscription {
    char topic[128] = "#";
    int  qos = 0;
    bool enabled = true;
    bool triggerSequence = false;
    char triggerPayload[64] = "";
    int  targetSequenceIdx = -1;
};

struct MQTTPublishPreset {
    char name[64] = "Preset";
    char topic[128] = "/rico/out";
    char payload[256] = "1";
    int  qos = 0;
    bool retain = false;
};

// Hardware Bridge
enum class HWDeviceType { ESP32 = 0, Arduino = 1, RaspberryPi = 2, Custom = 3 };

enum class HWPinType {
    DigitalOut = 0, PWMOut = 1, AnalogIn = 2, Servo = 3,
    NeoPixel = 4, I2C = 5, SerialUART = 6, DigitalIn = 7
};

struct HWPin {
    char      name[64] = "Pin 1";
    int       pinNumber = 0;
    HWPinType type = HWPinType::DigitalOut;
    float     currentValue = 0.0f;
    float     minVal = 0.0f;
    float     maxVal = 1.0f;
    bool      enabled = true;
    int       routeType = 0;
    int       routeDMXCh = 1;
    int       routeMIDICC = 0;
    int       routeMIDICh = 1;
    char      routeOSCAddr[128] = "/hw/pin";
    int       routeSeqIdx = -1;
    char      mqttTopic[128] = "";
    int       neoPixelCount = 30;
    int       i2cAddress = 0x3C;
    int       servoMinUS = 500;
    int       servoMaxUS = 2500;
};

struct HWDevice {
    char         name[64] = "My Device";
    HWDeviceType type = HWDeviceType::ESP32;
    char         mqttPrefix[64] = "rico/device1";
    char         ipAddress[64] = "";
    bool         online = false;
    bool         pendingApproval = false;
    float        lastSeen = -1.0f;
    std::vector<HWPin> pins;
    bool         showPins = false;
    float        cpuTemp = 0.0f;
    float        rssi = 0.0f;
    char         firmwareVer[32] = "";
};