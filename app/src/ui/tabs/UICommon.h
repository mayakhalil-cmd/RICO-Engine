#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "imgui.h"
#include "src/common/Utils.h"
#include "src/ui/tabs/RicoTypes.h"
#include "src/ui/tabs/RicoClasses.h"
#include "src/common/Log.h"
#include "src/common/Paths.h"
#include "src/app/Config.h"
#include "src/hardware/LEDState.h"
#include "src/midi/MidiState.h"
#include "src/midi/LoopMidiState.h"
#include "src/video/SpoutState.h"
#include "src/audio/AudioState.h"
#include "src/osc/OscState.h"
#include "src/hardware/ArtNetState.h"
#include "src/audio/GuitarState.h"
#include "src/video/NetworkVideo.h"
#include "src/app/MQTTState.h"
#include "src/app/AEState.h"

#include <array>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <deque>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <windows.h>
#include <d3d11.h>

#include "osc/OscOutboundPacketStream.h"
#include "osc/OscReceivedElements.h"
#include "osc/OscPacketListener.h"
#include "ip/UdpSocket.h"

#define HAS_RTMIDI
#include "RtMidi.h"

#include <SpoutDX.h>
#include <mqtt/async_client.h>
#include <nlohmann/json.hpp>
using json = nlohmann::json;

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// FORWARD DECLARATIONS
class AudioAnalyzer;
class SimpleGuitarSystem;
class LEDStripController;
class SerialController;

// ACCESSIBILITY
extern bool   g_showAccessibilityPopup;
extern int    g_colorBlindMode;
extern bool   g_highContrast;
extern bool   g_dyslexiaSpacing;
extern bool   g_dyslexiaFont;
extern float  g_uiFontScale;
extern float  g_dyslexiaFontScale;
extern float  g_dyslexiaSpacingScale;
extern ImVec4 g_subTabColor;
extern ImVec4 g_subTabColorHov;
extern ImVec4 g_subTabColorAct;

// D3D
extern ID3D11Device* g_pd3dDevice;
extern ID3D11DeviceContext* g_pd3dDeviceContext;
extern IDXGISwapChain* g_pSwapChain;
extern ID3D11RenderTargetView* g_mainRenderTargetView;
extern ID3D11Texture2D* g_sharedTexture;

// MIDI
extern MidiBackend               g_currentMidiBackend;
extern const char* g_midiBackendNames[];
extern std::unique_ptr<RtMidiIn> g_midiIn;
extern std::unique_ptr<RtMidiOut>g_midiOut;
extern bool                      g_midiInConnected;
extern bool                      g_midiOutConnected;
extern std::set<int>             g_activeNotes;
extern std::mutex                g_notesMutex;
extern std::chrono::steady_clock::time_point g_lastMidiActivity;
extern LoopMidiState             g_loopMidi;
extern std::vector<VirtualMidiPort> g_virtualPorts;
extern char                      g_newVirtualPortName[64];

// OSC
extern std::unique_ptr<UdpTransmitSocket> g_oscSender;
extern std::vector<OSCDestination>        g_oscDestinations;

// CONTROL MAPPINGS
extern std::map<std::string, ControlMapping> g_controlMappings;
extern ControlMapping* g_learningMapping;

// PRESETS
extern std::map<int, OSCPreset> g_presets;
extern int  g_currentPresetIndex;
extern int  g_selectedPresetForHelp;
extern bool g_showAboutPopup;
extern bool g_showPresetGuidePopup;

// AUDIO
extern AudioAnalyzer* g_audioAnalyzer;
extern std::vector<AudioBandMapping> g_audioBandMappings;
extern std::vector<LFOChannel>       g_lfoChannels;
extern std::vector<PulseChannel>     g_pulseChannels;

// GUITAR
extern SimpleGuitarSystem* g_guitarSystem;

// LED STRIP
extern LEDStripController g_ledStrip;

// SPOUT
extern spoutDX* g_spout;
extern spoutDX* g_spoutReceiver;
extern std::vector<std::string> g_spoutSenderList;

// ART-NET
extern SOCKET                     g_artnetSocket;
extern std::vector<ArtNetMapping> g_artnetMappings;

// MQTT
extern mqtt::async_client* g_mqttClient;
extern std::mutex                     g_mqttMutex;
extern std::vector<MQTTMessage>       g_mqttLog;
extern int                            g_mqttLogMax;
extern std::vector<MQTTSubscription>  g_mqttSubscriptions;
extern std::vector<MQTTPublishPreset> g_mqttPresets;

// HARDWARE
extern std::vector<HWDevice> g_hwDevices;
extern std::vector<HWDevice> g_hwPendingDevices;
extern int                   g_selectedHWDevice;
extern bool                  g_hwNewDeviceNotification;

// SEQUENCES
extern std::vector<TimedSequenceV2> g_sequences;
extern int                          g_selectedSequence;

// AFTER EFFECTS
extern AERecordingState g_aeRecState;

// MISC
extern std::atomic<bool> g_running;
extern int               g_ledComboLowBandHz;

// FUNCTION DECLARATIONS

// UI
void PushSubTabStyle();
void PopSubTabStyle();
void ApplyColorTheme();
void SwitchToNewInterface();
void ApplyAccessibilityStyle();
ImVec4 ApplyColorBlindFilter(ImVec4 c);
void DrawMappingsTab();
void DrawOSCDestinationsTab();

// Utility
std::string GetLocalIPAddress();
std::string MidiNoteToName(int note);

// Config
void SaveConfig();
void LoadConfig();
void InitializePresets();
void LoadPreset(int index);

// MIDI
void AutoConnectMIDI();
std::vector<std::string> GetMidiInDeviceNames();
std::vector<std::string> GetMidiOutDeviceNames();
bool OpenMidiInput(int deviceIndex);
bool OpenMidiOutput(int deviceIndex);
void SwitchMidiBackend(MidiBackend newBackend);
void CloseMidiPorts();
bool CreateNamedVirtualPort(const char* portName);
void SendMidiMessage(const std::vector<unsigned char>& message);
void DestroyVirtualPort(int index);
void CreateNativeVirtualPorts();
void DestroyNativeVirtualPorts();
void InitLoopMidiBridge(int portIndex);
void InitLoopMidiBridgeIn(int portIndex);
void InitializeMIDI();

// OSC
void AddOSCDestination(const std::string& name, const std::string& ip, int port);
void RemoveOSCDestination(size_t index);
void InitializeOSCDestinations();
void InitializeOSC();
void OSCReceiveThread();
void StopOSCReceive();
void SendOSCToAllDestinations(const char* address, float value);
void SendOSCToAllDestinations(const char* address, int value);

// Audio
void EnumerateAudioDevices();
bool StartAudioCapture();
bool StartAudioCaptureDevice(int device);
void AudioPcm_Enable(bool on);
size_t AudioPcm_Take(std::vector<int16_t>& out, int& rate);
void StopAudioCapture();
void ProcessAudioToDisplays();
void TickModulationChannels();

// Spout
void UpdateSpoutSenderList();
bool ConnectSpoutReceiver(const char* senderName);
void DisconnectSpoutReceiver();
bool CreateSpoutDisplaySRV();
bool UpdateSpoutReceiver();
bool ExportSharedTextureHandle();
void CleanupSpout();
bool SpoutSender_Start();
void SpoutSender_Stop();
void SpoutSender_SendFrame();

// ArtNet
bool InitArtNet();
void CleanupArtNet();
void SendArtNetDMX();
void RouteArtNetMappings(int midiCC, int midiCh, float normalizedValue);
void SetDMXChannel(int channel, float normalizedValue);

// MQTT
bool MQTTConnect();
void MQTTDisconnect();
void MQTTPublish(const char* topic, const char* payload, int qos = 0, bool retain = false);

// AE
void ExportAEKeyframes();
void RecordAEKeyframe();

// Hardware
std::string GenerateESPHomeConfig(const HWDevice& dev);
std::string GenerateArduinoSketch(const HWDevice& dev);
std::string GenerateRPiScript(const HWDevice& dev);

// Sequences
void UpdateTimedSequences();