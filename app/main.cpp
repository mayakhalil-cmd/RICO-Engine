// RICO
// Entry point, main loop and settings. Licensed under the MIT license, see LICENSE.

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "imgui.h"
#include "src/ui/tabs/UICommon.h"
#include "src/midi/WinMidi.h"
#include "src/video/NetworkVideo.h"
#include "src/video/PluginHost.h"
#include "src/web/Bridge.h"
#include "src/web/WebShell.h"
#include "resources/resource.h"
#include <algorithm>
#include <shellapi.h>
#include "imgui_impl_dx11.h"
#include "imgui_impl_win32.h"
#include <d3d11.h>
#include <tchar.h>
#include <windows.h>
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include "pffft.h"

#ifdef RICO_PAHO_EMPTY_STR_FIX
// paho-mqttpp3 1.6.0 declares this member but never defines it.
const std::string mqtt::message::EMPTY_STR;
#endif

ID3D11Texture2D* g_sharedTexture = nullptr;  // For AE sharing

// Math constant for FFT
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ===== ACCESSIBILITY GLOBALS ===== 
bool g_showAccessibilityPopup = false;
int  g_colorBlindMode = 0;
bool  g_highContrast = false;
bool g_dyslexiaSpacing = false;
bool g_dyslexiaFont = false;
float g_uiFontScale = 1.0f;
float g_dyslexiaFontScale = 1.0f;
float g_dyslexiaSpacingScale = 1.0f;
ImVec4 g_subTabColor = ImVec4(0.10f, 0.20f, 0.40f, 1.0f);
ImVec4 g_subTabColorHov = ImVec4(0.15f, 0.30f, 0.55f, 1.0f);
ImVec4 g_subTabColorAct = ImVec4(0.20f, 0.40f, 0.70f, 1.0f);

void PushSubTabStyle() {
    // Sub-tab colors are updated by ApplyColorTheme() into the globals instead
    ImGui::PushStyleColor(ImGuiCol_Tab, g_subTabColor);
    ImGui::PushStyleColor(ImGuiCol_TabHovered, g_subTabColorHov);
    ImGui::PushStyleColor(ImGuiCol_TabActive, g_subTabColorAct);
}
void PopSubTabStyle() { ImGui::PopStyleColor(3); }



#define OSC_MESSAGE_BUFFER_SIZE 1024

    

    extern LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);


    // ===== FORWARD DECLARATIONS =====

    // D3D
    bool CreateDeviceD3D(HWND hWnd);
    void CleanupDeviceD3D();
    void CreateRenderTarget();
    void CleanupRenderTarget();
    LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

    // Main tabs
    void DrawApplicationMenuBar();
    void DrawDashboardTab();
    void DrawMIDITab();
    void DrawOSCTab();
    void DrawDMXTab();
    void DrawSpoutTab();
    void DrawNetworkVideoTab();
    void DrawMQTTTab();
    void DrawMultimediaTab();
    void DrawAudioAnalysisTab();
    void DrawAbletonLinkTab();
    void DrawAccessibilityPopup();
    void DrawHelpPopups();

    // MIDI sub-tabs
    void DrawMIDI_DevicesSubTab();
    void DrawMIDI_MappingsSubTab();
    void DrawGuitarMIDITab();

    // OSC sub-tabs
    void DrawOSC_DestinationsSubTab();
    void DrawOSC_MappingsSubTab();
    void DrawOSC_AudioRoutingSubTab();

    // Spout sub-tabs
    void DrawSpout_SendSubTab();
    void DrawSpout_AEExportSubTab();

    // Multimedia sub-tabs
    void DrawMultimedia_LEDStripSubTab();
    void DrawMultimedia_AfterEffectsSubTab();
    void DrawMultimedia_TimedSequencesSubTab();

    ImVec4 ApplyColorBlindFilter(ImVec4 c) {
        float r = c.x, g = c.y, b = c.z;
        float nr = r, ng = g, nb = b;
        switch (g_colorBlindMode) {
        case 1: // Deuteranopia
            nr = 0.625f * r + 0.375f * g;
            ng = 0.700f * r + 0.300f * g;
            nb = 0.300f * g + 0.700f * b;
            break;
        case 2: // Protanopia
            nr = 0.567f * r + 0.433f * g;
            ng = 0.558f * r + 0.442f * g;
            nb = 0.242f * g + 0.758f * b;
            break;
        case 3: // Tritanopia
            nr = 0.950f * r + 0.050f * g;
            ng = 0.433f * g + 0.567f * b;
            nb = 0.475f * g + 0.525f * b;
            break;
        case 4: // Achromatopsia
            float lum = 0.299f * r + 0.587f * g + 0.114f * b;
            nr = ng = nb = lum;
            break;
        }
        nr = nr < 0.0f ? 0.0f : (nr > 1.0f ? 1.0f : nr);
        ng = ng < 0.0f ? 0.0f : (ng > 1.0f ? 1.0f : ng);
        nb = nb < 0.0f ? 0.0f : (nb > 1.0f ? 1.0f : nb);
        return ImVec4(nr, ng, nb, c.w);
    }

    void ApplyAccessibilityStyle() {
        ImGuiStyle& style = ImGui::GetStyle();
        ImVec4* c = style.Colors;

        // Always start from a clean dark base so colors never compound
        ImGui::StyleColorsDark();

        switch (g_colorBlindMode) {
        case 0: // None - just use whatever theme is set, nothing to do
            break;

        case 1: // Deuteranopia - red/green confusion
            // Replace greens with blues, reds stay, no pure green anywhere
            c[ImGuiCol_Button] = ImVec4(0.20f, 0.40f, 0.90f, 1.0f); // blue
            c[ImGuiCol_ButtonHovered] = ImVec4(0.30f, 0.55f, 1.00f, 1.0f);
            c[ImGuiCol_ButtonActive] = ImVec4(0.15f, 0.30f, 0.75f, 1.0f);
            c[ImGuiCol_Header] = ImVec4(0.20f, 0.40f, 0.90f, 0.8f);
            c[ImGuiCol_HeaderHovered] = ImVec4(0.30f, 0.55f, 1.00f, 0.9f);
            c[ImGuiCol_HeaderActive] = ImVec4(0.15f, 0.30f, 0.75f, 1.0f);
            c[ImGuiCol_Tab] = ImVec4(0.12f, 0.25f, 0.55f, 1.0f);
            c[ImGuiCol_TabActive] = ImVec4(0.20f, 0.40f, 0.90f, 1.0f);
            c[ImGuiCol_TabHovered] = ImVec4(0.30f, 0.55f, 1.00f, 1.0f);
            c[ImGuiCol_CheckMark] = ImVec4(1.00f, 0.85f, 0.00f, 1.0f); // yellow checkmarks
            c[ImGuiCol_SliderGrab] = ImVec4(1.00f, 0.85f, 0.00f, 1.0f);
            c[ImGuiCol_FrameBg] = ImVec4(0.10f, 0.15f, 0.30f, 1.0f);
            c[ImGuiCol_TitleBgActive] = ImVec4(0.15f, 0.30f, 0.65f, 1.0f);
            break;

        case 2: // Protanopia - red deficiency
            // Use blue/yellow scheme, avoid red entirely
            c[ImGuiCol_Button] = ImVec4(0.00f, 0.45f, 0.85f, 1.0f);
            c[ImGuiCol_ButtonHovered] = ImVec4(0.10f, 0.60f, 1.00f, 1.0f);
            c[ImGuiCol_ButtonActive] = ImVec4(0.00f, 0.35f, 0.70f, 1.0f);
            c[ImGuiCol_Header] = ImVec4(0.00f, 0.45f, 0.85f, 0.8f);
            c[ImGuiCol_HeaderHovered] = ImVec4(0.10f, 0.60f, 1.00f, 0.9f);
            c[ImGuiCol_HeaderActive] = ImVec4(0.00f, 0.35f, 0.70f, 1.0f);
            c[ImGuiCol_Tab] = ImVec4(0.00f, 0.25f, 0.50f, 1.0f);
            c[ImGuiCol_TabActive] = ImVec4(0.00f, 0.45f, 0.85f, 1.0f);
            c[ImGuiCol_TabHovered] = ImVec4(0.10f, 0.60f, 1.00f, 1.0f);
            c[ImGuiCol_CheckMark] = ImVec4(1.00f, 0.90f, 0.00f, 1.0f); // yellow
            c[ImGuiCol_SliderGrab] = ImVec4(1.00f, 0.90f, 0.00f, 1.0f);
            c[ImGuiCol_FrameBg] = ImVec4(0.08f, 0.15f, 0.28f, 1.0f);
            c[ImGuiCol_TitleBgActive] = ImVec4(0.00f, 0.30f, 0.60f, 1.0f);
            break;

        case 3: // Tritanopia - blue/yellow confusion
            // Use red/green scheme, avoid blue and yellow
            c[ImGuiCol_Button] = ImVec4(0.70f, 0.15f, 0.15f, 1.0f); // red
            c[ImGuiCol_ButtonHovered] = ImVec4(0.90f, 0.25f, 0.25f, 1.0f);
            c[ImGuiCol_ButtonActive] = ImVec4(0.55f, 0.10f, 0.10f, 1.0f);
            c[ImGuiCol_Header] = ImVec4(0.70f, 0.15f, 0.15f, 0.8f);
            c[ImGuiCol_HeaderHovered] = ImVec4(0.90f, 0.25f, 0.25f, 0.9f);
            c[ImGuiCol_HeaderActive] = ImVec4(0.55f, 0.10f, 0.10f, 1.0f);
            c[ImGuiCol_Tab] = ImVec4(0.35f, 0.08f, 0.08f, 1.0f);
            c[ImGuiCol_TabActive] = ImVec4(0.70f, 0.15f, 0.15f, 1.0f);
            c[ImGuiCol_TabHovered] = ImVec4(0.90f, 0.25f, 0.25f, 1.0f);
            c[ImGuiCol_CheckMark] = ImVec4(0.20f, 0.85f, 0.40f, 1.0f); // green checkmarks
            c[ImGuiCol_SliderGrab] = ImVec4(0.20f, 0.85f, 0.40f, 1.0f);
            c[ImGuiCol_FrameBg] = ImVec4(0.20f, 0.08f, 0.08f, 1.0f);
            c[ImGuiCol_TitleBgActive] = ImVec4(0.50f, 0.10f, 0.10f, 1.0f);
            break;

        case 4: // Achromatopsia - full greyscale vision
            // Everything in greyscale with high contrast between elements
            c[ImGuiCol_WindowBg] = ImVec4(0.10f, 0.10f, 0.10f, 1.0f);
            c[ImGuiCol_Button] = ImVec4(0.45f, 0.45f, 0.45f, 1.0f);
            c[ImGuiCol_ButtonHovered] = ImVec4(0.65f, 0.65f, 0.65f, 1.0f);
            c[ImGuiCol_ButtonActive] = ImVec4(0.30f, 0.30f, 0.30f, 1.0f);
            c[ImGuiCol_Header] = ImVec4(0.40f, 0.40f, 0.40f, 0.8f);
            c[ImGuiCol_HeaderHovered] = ImVec4(0.60f, 0.60f, 0.60f, 0.9f);
            c[ImGuiCol_HeaderActive] = ImVec4(0.30f, 0.30f, 0.30f, 1.0f);
            c[ImGuiCol_Tab] = ImVec4(0.20f, 0.20f, 0.20f, 1.0f);
            c[ImGuiCol_TabActive] = ImVec4(0.50f, 0.50f, 0.50f, 1.0f);
            c[ImGuiCol_TabHovered] = ImVec4(0.65f, 0.65f, 0.65f, 1.0f);
            c[ImGuiCol_CheckMark] = ImVec4(1.00f, 1.00f, 1.00f, 1.0f);
            c[ImGuiCol_SliderGrab] = ImVec4(0.80f, 0.80f, 0.80f, 1.0f);
            c[ImGuiCol_FrameBg] = ImVec4(0.18f, 0.18f, 0.18f, 1.0f);
            c[ImGuiCol_FrameBgHovered] = ImVec4(0.28f, 0.28f, 0.28f, 1.0f);
            c[ImGuiCol_TitleBgActive] = ImVec4(0.30f, 0.30f, 0.30f, 1.0f);
            c[ImGuiCol_Text] = ImVec4(0.95f, 0.95f, 0.95f, 1.0f);
            c[ImGuiCol_Separator] = ImVec4(0.50f, 0.50f, 0.50f, 1.0f);
            break;
        }

        // High contrast overlays ON TOP of color blind mode (independent)
        if (g_highContrast) {
            c[ImGuiCol_WindowBg] = ImVec4(0.00f, 0.00f, 0.00f, 1.0f);
            c[ImGuiCol_Text] = ImVec4(1.00f, 1.00f, 1.00f, 1.0f);
            c[ImGuiCol_FrameBg] = ImVec4(0.10f, 0.10f, 0.10f, 1.0f);
            c[ImGuiCol_FrameBgHovered] = ImVec4(0.20f, 0.20f, 0.20f, 1.0f);
            c[ImGuiCol_Separator] = ImVec4(1.00f, 1.00f, 1.00f, 0.50f);
            // Keep hue-specific button colors from above, just force text white
        }

        // Dyslexia spacing (font swap handled separately at startup)
        if (g_dyslexiaSpacing) {
            style.ItemSpacing = ImVec2(10.0f, 8.0f);
            style.FramePadding = ImVec2(8.0f, 6.0f);
            style.CellPadding = ImVec2(6.0f, 6.0f);
        }
        else {
            style.ItemSpacing = ImVec2(8.0f, 4.0f);
            style.FramePadding = ImVec2(4.0f, 3.0f);
            style.CellPadding = ImVec2(4.0f, 2.0f);
        }

        if (g_dyslexiaFont)
            ImGui::GetIO().FontGlobalScale = g_dyslexiaFontScale;
        else
            ImGui::GetIO().FontGlobalScale = g_uiFontScale;
    }


    // Helper function to get local IP address
    std::string GetLocalIPAddress() {
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) return "127.0.0.1";

        char hostname[256];
        if (gethostname(hostname, sizeof(hostname)) == SOCKET_ERROR) {
            WSACleanup();
            return "127.0.0.1";
        }

        struct hostent* host = gethostbyname(hostname);
        if (host == nullptr) {
            WSACleanup();
            return "127.0.0.1";
        }

        std::string ip = inet_ntoa(*((struct in_addr*)host->h_addr_list[0]));
        WSACleanup();
        return ip;
    }

    // D3D Globals
    ID3D11Device* g_pd3dDevice = nullptr;
    ID3D11DeviceContext* g_pd3dDeviceContext = nullptr;
    IDXGISwapChain* g_pSwapChain = nullptr;
    ID3D11RenderTargetView* g_mainRenderTargetView = nullptr;
    static HWND g_hWnd = nullptr;

    // Global State
    std::map<std::string, ControlMapping> g_controlMappings;
    ControlMapping* g_learningMapping = nullptr;
    std::atomic<bool> g_running{ true };
    std::thread g_oscThread;
    std::map<int, OSCPreset> g_presets;
    int g_currentPresetIndex = 0;
    int g_selectedPresetForHelp = -1; // For help popup
    bool g_showAboutPopup = false;
    bool g_showPresetGuidePopup = false;

    // Font globals for accessibility
    static ImFont* g_fontDefault = nullptr;
    static ImFont* g_fontOpenDyslexic = nullptr;
  
    AERecordingState g_aeRecState;

// ===== LED STRIP STATE =====
LEDStripController g_ledStrip;

// ===== GUITAR-TO-MIDI GLOBALS =====
SimpleGuitarSystem* g_guitarSystem = nullptr;

// LED combo preset: low band cutoff
int g_ledComboLowBandHz = 200;  

// Art-Net / DMX globals
SOCKET g_artnetSocket = INVALID_SOCKET;

std::vector<ArtNetMapping> g_artnetMappings;

// Global audio routing mappings
std::vector<AudioBandMapping> g_audioBandMappings;
   
std::vector<LFOChannel>   g_lfoChannels;
std::vector<PulseChannel> g_pulseChannels;

// Image loading
static ID3D11ShaderResourceView* g_loadedTexture = nullptr;
static int g_imageWidth = 0, g_imageHeight = 0;
static char g_imagePath[256] = "";

std::vector<MQTTMessage> g_mqttLog;
int g_mqttLogMax = 100;

std::vector<MQTTSubscription> g_mqttSubscriptions;

std::vector<MQTTPublishPreset> g_mqttPresets;

mqtt::async_client* g_mqttClient = nullptr;
std::mutex g_mqttMutex;

std::vector<TimedSequenceV2> g_sequences;
int g_selectedSequence = 0;

std::vector<HWDevice> g_hwDevices;
std::vector<HWDevice> g_hwPendingDevices;  // awaiting approval
int g_selectedHWDevice = 0;
bool g_hwNewDeviceNotification = false;

// Timing and sequences
struct TimedSequence {
std::string name;
float triggerTime;
int sequenceId;
bool active;
std::chrono::steady_clock::time_point startTime;
};

static std::vector<TimedSequence> g_timedSequences;
static bool g_sequenceTimerRunning = false;
static std::chrono::steady_clock::time_point g_sequenceStartTime;

    // ===== PRESETS =====
    void InitializePresets() {
        g_presets.clear();

        g_presets[0] = OSCPreset("Unreal Engine", "/game", 8000, "127.0.0.1", true,
            "Remote Control Protocol for real-time parameter control in Unreal Engine",
            "1. Enable Remote Control Web Interface in Project Settings\n2. Create Remote Control Preset\n3. Expose properties you want to control\n4. Use addresses like /game/PropertyName\n5. Default port 8000",
            "Standard MIDI input, all control types supported. Notes trigger boolean actions, CCs control float parameters.",
            "OSC addresses: /game/key1, /game/slider1, etc. Uses float values 0.0-1.0 for most parameters, booleans for triggers.");

        g_presets[1] = OSCPreset("Unity", "/unity", 8001, "127.0.0.1", true,
            "OSC communication for Unity using packages like OSC Jack or UnityOSC",
            "1. Import OSC package from Package Manager\n2. Add OSC Receiver component to GameObject\n3. Set listening port to 8001\n4. Create scripts to handle incoming OSC\n5. Use addresses like /unity/parameter",
            "MIDI CC controllers map to Unity parameters. Notes can trigger events or game actions.",
            "OSC addresses: /unity/transform/x, /unity/material/color, etc. Supports float, int, and boolean data types.");

        g_presets[2] = OSCPreset("Ableton Live", "/live", 9000, "127.0.0.1", false,
            "Live API control for automation and device parameters using Max4Live",
            "1. Install Max4Live OSC device\n2. Configure OSC input port 9000\n3. Map to track and device parameters\n4. Use Live API addresses\n5. Enable in Live Preferences",
            "MIDI controllers send CC data to Live parameters. Program changes switch between clips/scenes.",
            "OSC addresses: /live/track/volume, /live/device/parameter. Uses float values 0.0-1.0, integers for selection.");

        g_presets[3] = OSCPreset("Logic Pro", "/logic", 8002, "127.0.0.1", true,
            "Logic Pro remote control via OSC using Environment or third-party plugins",
            "1. Set up MIDI Environment with OSC objects\n2. Install OSC plugin if needed\n3. Configure routing port 8002\n4. Map to Logic parameters\n5. Use Control Surface setup",
            "MIDI CC maps to Logic automation parameters. Program changes select channel strips or patches.",
            "OSC addresses: /logic/track1/volume, /logic/eq/freq. Typically uses indexed addressing with float values.");

        g_presets[4] = OSCPreset("TouchDesigner", "/td", 9001, "127.0.0.1", false,
            "Real-time visual programming with OSC In CHOP",
            "1. Add OSC In CHOP to network\n2. Set port to 9001\n3. Configure address patterns\n4. Connect to parameters\n5. Use in visual networks",
            "MIDI input controls visual parameters in real-time. All MIDI types supported for different parameter control.",
            "OSC addresses: /td/comp1/opacity, /td/geo1/scale. Uses float values, can drive any parameter in TD network.");

        g_presets[5] = OSCPreset("Max/MSP", "/max", 7400, "127.0.0.1", false,
            "Visual programming with native OSC support using udpreceive",
            "1. Use udpreceive object\n2. Set port 7400\n3. Connect to route object\n4. Parse with OSC objects\n5. Map to synthesis parameters",
            "MIDI controllers drive synthesis and processing parameters. Notes trigger samples, CCs control effects.",
            "OSC addresses: /max/synth/freq, /max/filter/cutoff. Supports all OSC data types including lists and bundles.");

        g_presets[6] = OSCPreset("Reaper", "/reaper", 8003, "127.0.0.1", true,
            "DAW with built-in OSC control surface support",
            "1. Add OSC control surface\n2. Configure in Preferences\n3. Set port 8003\n4. Use ReaOSC patterns\n5. Map to tracks and FX",
            "MIDI faders control track volumes, knobs control FX parameters. Notes can trigger recording/playback.",
            "OSC addresses: /track/1/volume, /fx/1/param/1. Uses ReaOSC standard with float values and feedback support.");

        g_presets[7] = OSCPreset("VCV Rack", "/vcv", 8004, "127.0.0.1", true,
            "Modular synthesizer with OSC-CV modules",
            "1. Add OSC-CV module\n2. Set input port 8004\n3. Map to CV inputs\n4. Control modules in real-time\n5. Use with other CV modules",
            "MIDI CC values convert to CV voltages. Notes generate gate signals. Pitch bend controls CV offsets.",
            "OSC addresses: /vcv/cv1, /vcv/gate1. Outputs CV voltages typically 0-10V, gates are 0V/10V boolean signals.");

        g_presets[8] = OSCPreset("Bitwig Studio", "/bitwig", 8005, "127.0.0.1", true,
            "DAW with comprehensive OSC API support",
            "1. Enable OSC in Settings\n2. Add controller script\n3. Set port 8005\n4. Map to devices/tracks\n5. Use Bitwig OSC API",
            "Full MIDI support with automatic device mapping. CCs control parameters, notes trigger clips.",
            "OSC addresses: /track/1/volume, /device/1/macro/1. Rich API with bidirectional communication and feedback.");

        g_presets[9] = OSCPreset("Custom", "/custom", 8000, "127.0.0.1", true,
            "Custom configuration for any OSC-compatible application",
            "1. Configure your app's OSC settings\n2. Set correct IP and port\n3. Define address patterns\n4. Test with simple controls\n5. Build complex mappings",
            "Flexible MIDI mapping supporting all message types. Configure data types and ranges as needed.",
            "Custom OSC addresses and data types. Design your own protocol based on application requirements.");
    }

    // Color themes
    void ApplyColorTheme() {
        ImGuiStyle& style = ImGui::GetStyle();

        switch (g_config.colorTheme) {
        case 0: // Dark theme
            ImGui::StyleColorsDark();
            break;
        case 1: // Light theme
            ImGui::StyleColorsLight();
            break;
        case 2:
        {
            ImGui::StyleColorsDark();
            ImVec4 customColor = HexToImVec4(g_config.customColorHex);
            ImVec4 customColor2 = HexToImVec4(g_config.customColorHex2);

            ImVec4 customColorHovered = ImVec4(customColor.x + 0.1f, customColor.y + 0.1f, customColor.z + 0.1f, customColor.w);
            ImVec4 customColorActive = ImVec4(customColor.x + 0.2f, customColor.y + 0.2f, customColor.z + 0.2f, customColor.w);
            ImVec4 customColorDim = ImVec4(customColor.x * 0.7f, customColor.y * 0.7f, customColor.z * 0.7f, 0.7f);

            ImVec4 sec = customColor2;
            ImVec4 secLight = ImVec4(customColor2.x + 0.08f, customColor2.y + 0.08f, customColor2.z + 0.08f, customColor2.w);
            ImVec4 secDark = ImVec4(customColor2.x * 0.7f, customColor2.y * 0.7f, customColor2.z * 0.7f, customColor2.w);
            ImVec4 secBright = ImVec4(customColor2.x + 0.20f, customColor2.y + 0.20f, customColor2.z + 0.20f, customColor2.w);


            // Primary color, interactive elements
            style.Colors[ImGuiCol_TitleBg] = customColorDim;
            style.Colors[ImGuiCol_TitleBgActive] = customColorActive;
            style.Colors[ImGuiCol_TitleBgCollapsed] = customColorDim;
            style.Colors[ImGuiCol_Header] = customColorDim;
            style.Colors[ImGuiCol_HeaderHovered] = customColorHovered;
            style.Colors[ImGuiCol_HeaderActive] = customColorActive;
            style.Colors[ImGuiCol_Button] = customColorDim;
            style.Colors[ImGuiCol_ButtonHovered] = customColorHovered;
            style.Colors[ImGuiCol_ButtonActive] = customColorActive;
            style.Colors[ImGuiCol_Tab] = customColorDim;
            style.Colors[ImGuiCol_TabHovered] = customColorHovered;
            style.Colors[ImGuiCol_TabActive] = customColorActive;
            style.Colors[ImGuiCol_TabUnfocused] = customColorDim;
            style.Colors[ImGuiCol_TabUnfocusedActive] = customColor;
            style.Colors[ImGuiCol_CheckMark] = customColorActive;
            style.Colors[ImGuiCol_SliderGrab] = customColor;
            style.Colors[ImGuiCol_SliderGrabActive] = customColorActive;
            style.Colors[ImGuiCol_ScrollbarGrab] = customColor;
            style.Colors[ImGuiCol_ScrollbarGrabHovered] = customColorHovered;
            style.Colors[ImGuiCol_ScrollbarGrabActive] = customColorActive;
            style.Colors[ImGuiCol_TextSelectedBg] = customColorDim;
            style.Colors[ImGuiCol_NavHighlight] = customColorActive;

            // Secondary color, backgrounds and frames
            style.Colors[ImGuiCol_WindowBg] = secDark;
            style.Colors[ImGuiCol_ChildBg] = secDark;
            style.Colors[ImGuiCol_PopupBg] = sec;
            ImVec4 frame = HexToImVec4(g_config.customColorHex4);
            ImVec4 frameLight = ImVec4(frame.x + 0.08f, frame.y + 0.08f, frame.z + 0.08f, frame.w);
            style.Colors[ImGuiCol_FrameBg] = frame;
            style.Colors[ImGuiCol_FrameBgHovered] = frameLight;
            style.Colors[ImGuiCol_FrameBgActive] = frameLight;
            style.Colors[ImGuiCol_ScrollbarBg] = secDark;
            style.Colors[ImGuiCol_Separator] = secLight;
            style.Colors[ImGuiCol_SeparatorHovered] = customColorHovered;
            style.Colors[ImGuiCol_SeparatorActive] = customColorActive;
            style.Colors[ImGuiCol_MenuBarBg] = sec;

            // Update sub-tab globals so PushSubTabStyle picks them up
            ImVec4 sub3 = HexToImVec4(g_config.customColorHex3);
            ImVec4 sub3Light = ImVec4(sub3.x + 0.10f, sub3.y + 0.10f, sub3.z + 0.10f, sub3.w);
            ImVec4 sub3Bright = ImVec4(sub3.x + 0.20f, sub3.y + 0.20f, sub3.z + 0.20f, sub3.w);
            g_subTabColor = sub3;
            g_subTabColorHov = sub3Light;
            g_subTabColorAct = sub3Bright;
        }
        break;
        }

        style.ScaleAllSizes(g_config.uiScale);
    }

    // ===== CONFIG =====
    // Some settings can only be applied after the engine has started.
    static int g_pendingMidiBackend = 0;
    static std::string g_pendingTransportId;
    static std::vector<std::string> g_pendingVirtualPorts;

    void SaveConfig() {
        try {
            std::ofstream file(Paths::DataFile("rico_settings.txt"));
            if (file.is_open()) {
                file << "# RICO settings\n";
                file << "sendToOSC=" << (g_config.sendToOSC ? 1 : 0) << "\n";
                file << "sendToMIDI=" << (g_config.sendToMIDI ? 1 : 0) << "\n";
                file << "receiveFromOSC=" << (g_config.receiveFromOSC ? 1 : 0) << "\n";
                file << "midiThru=" << (g_config.midiThru ? 1 : 0) << "\n";
                file << "autoConnectMIDI=" << (g_config.autoConnectMIDI ? 1 : 0) << "\n";
                file << "oscAddress=" << g_config.oscAddress << "\n";
                file << "oscIP=" << g_config.oscIP << "\n";
                file << "oscSendPort=" << g_config.oscSendPort << "\n";
                file << "oscListenPort=" << g_config.oscListenPort << "\n";
                file << "midiInDevice=" << g_config.midiInDevice << "\n";
                file << "midiOutDevice=" << g_config.midiOutDevice << "\n";
                file << "uiScale=" << g_config.uiScale << "\n";
                file << "colorTheme=" << g_config.colorTheme << "\n";
                file << "customColorHex=" << g_config.customColorHex << "\n";
                file << "customColorHex2=" << g_config.customColorHex2 << "\n";
                file << "customColorHex3=" << g_config.customColorHex3 << "\n";
                file << "customColorHex4=" << g_config.customColorHex4 << "\n";
                file << "currentPreset=" << g_currentPresetIndex << "\n";
                file << "ledComboGradientMode=" << (g_ledState.comboGradientMode ? 1 : 0) << "\n";
                file << "midiBackend=" << (int)g_currentMidiBackend << "\n";
                file << "classicUI=" << (g_config.classicUI ? 1 : 0) << "\n";
                file << "shareOnNetwork=" << (g_config.shareOnNetwork ? 1 : 0) << "\n";

                file << "\n# Network video\n";
                {
                    const auto& transports = PluginHost_Transports();
                    if (g_netVideo.transport >= 0 && g_netVideo.transport < (int)transports.size())
                        file << "netVideoTransport=" << transports[g_netVideo.transport].id << "\n";
                }
                file << "netVideoName=" << g_netVideo.senderName << "\n";
                file << "netVideoSpoutBridge=" << (g_netVideo.bridgeToSpout ? 1 : 0) << "\n";

                file << "\n# Virtual MIDI ports, made again on start\n";
                for (const auto& port : g_virtualPorts)
                    file << "virtualPort=" << port.name << "\n";

                //Audio Bars + Spark Colors
                file << "\n# LED Strip Audio Colors\n";
                file << "ledAudioBarsColor=" << g_ledState.audioBarsColor.r << "," << g_ledState.audioBarsColor.g << "," << g_ledState.audioBarsColor.b << "\n";
                file << "ledSparkColor=" << g_ledState.sparkColor.r << "," << g_ledState.sparkColor.g << "," << g_ledState.sparkColor.b << "\n";
                file << "ledFrequencyBrightness=" << (g_ledState.freqBrightness ? 1 : 0) << "\n";
                file << "ledBrightnessThreshold=" << g_ledState.brightnessThresholdHz << "\n";
                file << "ledBrightnessBelow=" << g_ledState.brightnessBelowThreshold << "\n";
                file << "ledBrightnessAbove=" << g_ledState.brightnessAboveThreshold << "\n";

                //Save OSC destinations
                file << "\n# OSC Destinations\n";
                for (const auto& dest : g_oscDestinations) {
                    file << "destination=" << dest.name << "," << dest.ip << ","
                        << dest.port << "," << (dest.enabled ? 1 : 0) << "\n";
                }

                //Save audio band mappings
                file << "\n# Audio Band Mappings\n";
                for (const auto& mapping : g_audioBandMappings) {
                    file << "audioMapping=" << mapping.displayName << ","
                        << mapping.oscAddress << ","
                        << mapping.ip << ","
                        << mapping.port << ","
                        << mapping.bandType << ","
                        << (mapping.enabled ? 1 : 0) << ","
                        << mapping.multiplier << "\n";
                }

                file << "\n# Control Mappings\n";
                for (const auto& pair : g_controlMappings) {
                    const ControlMapping& mapping = pair.second;
                    file << "mapping=" << mapping.controlType << ","
                        << mapping.channel << ","
                        << mapping.controller << ","
                        << mapping.oscAddress << ","
                        << mapping.displayName << ","
                        << mapping.dataType << ","
                        << mapping.minValue << ","
                        << mapping.maxValue << ","
                        << (mapping.isMomentary ? 1 : 0) << "\n";
                }

                file.close();
            }
        }
        catch (std::exception& e) {
            std::cout << "Error saving config: " << e.what() << std::endl;
        }
    }

    void LoadConfig() {
        try {
            std::string path = Paths::DataFile("rico_settings.txt");
            if (GetFileAttributesA(path.c_str()) == INVALID_FILE_ATTRIBUTES)
                path = Paths::ExeDir() + "midi_osc_config.txt";   // settings from RICO 2
            std::ifstream file(path);
            std::string line;

            while (std::getline(file, line)) {
                if (line.empty() || line[0] == '#') continue;

                size_t pos = line.find('=');
                if (pos == std::string::npos) continue;

                std::string key = line.substr(0, pos);
                std::string value = line.substr(pos + 1);

                if (key == "sendToOSC") g_config.sendToOSC = (value == "1");
                else if (key == "sendToMIDI") g_config.sendToMIDI = (value == "1");
                else if (key == "receiveFromOSC") g_config.receiveFromOSC = (value == "1");
                else if (key == "midiThru") g_config.midiThru = (value == "1");
                else if (key == "autoConnectMIDI") g_config.autoConnectMIDI = (value == "1");
                else if (key == "oscAddress") strcpy_s(g_config.oscAddress, value.c_str());
                else if (key == "oscIP") strcpy_s(g_config.oscIP, value.c_str());
                else if (key == "oscSendPort") g_config.oscSendPort = std::stoi(value);
                else if (key == "oscListenPort") g_config.oscListenPort = std::stoi(value);
                else if (key == "midiInDevice") g_config.midiInDevice = std::stoi(value);
                else if (key == "midiOutDevice") g_config.midiOutDevice = std::stoi(value);
                else if (key == "uiScale") g_config.uiScale = std::stof(value);
                else if (key == "colorTheme") g_config.colorTheme = std::stoi(value);
                else if (key == "customColorHex") strcpy_s(g_config.customColorHex, value.c_str());
                else if (key == "customColorHex2") strcpy_s(g_config.customColorHex2, value.c_str());
                else if (key == "customColorHex3") strcpy_s(g_config.customColorHex3, value.c_str());
                else if (key == "customColorHex4") strcpy_s(g_config.customColorHex4, value.c_str());
                else if (key == "ledComboGradientMode") g_ledState.comboGradientMode = (value == "1");
                else if (key == "midiBackend") g_pendingMidiBackend = std::stoi(value);
                else if (key == "classicUI") g_config.classicUI = (value == "1");
                else if (key == "shareOnNetwork") g_config.shareOnNetwork = (value == "1");
                else if (key == "netVideoTransport") g_pendingTransportId = value;
                else if (key == "netVideoName") strncpy_s(g_netVideo.senderName, sizeof(g_netVideo.senderName), value.c_str(), _TRUNCATE);
                else if (key == "netVideoSpoutBridge") g_netVideo.bridgeToSpout = (value == "1");
                else if (key == "virtualPort") g_pendingVirtualPorts.push_back(value);
                else if (key == "currentPreset") {
                    int presetIndex = std::stoi(value);
                    if (g_presets.find(presetIndex) != g_presets.end()) {
                        g_currentPresetIndex = presetIndex;
                    }
                }

                //Load OSC destinations
                else if (key == "destination") {
                    // Parse destination: name,ip,port,enabled
                    std::vector<std::string> parts;
                    std::stringstream ss(value);
                    std::string item;

                    while (std::getline(ss, item, ',')) {
                        parts.push_back(item);
                    }

                    if (parts.size() >= 4) {
                        OSCDestination dest;
                        dest.name = parts[0];
                        dest.ip = parts[1];
                        dest.port = std::stoi(parts[2]);
                        dest.enabled = (parts[3] == "1");
                        g_oscDestinations.push_back(std::move(dest));
                    }
                }
                else if (key == "mapping") {

                    // Parse mapping: type,channel,controller,oscAddress,displayName,dataType,minVal,maxVal,momentary
                    std::vector<std::string> parts;
                    std::stringstream ss(value);
                    std::string item;

                    while (std::getline(ss, item, ',')) {
                        parts.push_back(item);
                    }

                    if (parts.size() >= 9) {
                        ControlMapping mapping;
                        mapping.controlType = std::stoi(parts[0]);
                        mapping.channel = std::stoi(parts[1]);
                        mapping.controller = std::stoi(parts[2]);
                        mapping.oscAddress = parts[3];
                        mapping.displayName = parts[4];
                        mapping.dataType = parts[5];
                        mapping.minValue = std::stof(parts[6]);
                        mapping.maxValue = std::stof(parts[7]);
                        mapping.isMomentary = (parts[8] == "1");

                        std::string key = std::to_string(mapping.controlType) + ":" +
                            std::to_string(mapping.channel) + ":" +
                            std::to_string(mapping.controller);
                        g_controlMappings[key] = mapping;
                    }
                }
                else if (key == "ledAudioBarsColor") {
                    std::stringstream ss(value);
                    std::string item;
                    std::vector<int> colors;
                    while (std::getline(ss, item, ',')) {
                        colors.push_back(std::stoi(item));
                    }
                    if (colors.size() >= 3) {
                        g_ledState.audioBarsColor.r = colors[0];
                        g_ledState.audioBarsColor.g = colors[1];
                        g_ledState.audioBarsColor.b = colors[2];
                    }
                }
                else if (key == "ledSparkColor") {
                    std::stringstream ss(value);
                    std::string item;
                    std::vector<int> colors;
                    while (std::getline(ss, item, ',')) {
                        colors.push_back(std::stoi(item));
                    }
                    if (colors.size() >= 3) {
                        g_ledState.sparkColor.r = colors[0];
                        g_ledState.sparkColor.g = colors[1];
                        g_ledState.sparkColor.b = colors[2];
                    }
                }
                else if (key == "ledFrequencyBrightness") g_ledState.freqBrightness = (value == "1");
                else if (key == "ledBrightnessThreshold") g_ledState.brightnessThresholdHz = std::stoi(value);
                else if (key == "ledBrightnessBelow") g_ledState.brightnessBelowThreshold = std::stof(value);
                else if (key == "ledBrightnessAbove") g_ledState.brightnessAboveThreshold = std::stof(value);

                // Load audio band mappings
                else if (key == "audioMapping") {
                    std::vector<std::string> parts;
                    std::stringstream ss(value);
                    std::string item;

                    while (std::getline(ss, item, ',')) {
                        parts.push_back(item);
                    }

                    if (parts.size() >= 7) {
                        AudioBandMapping mapping;
                        mapping.displayName = parts[0];
                        mapping.oscAddress = parts[1];
                        mapping.ip = parts[2];
                        mapping.port = std::stoi(parts[3]);
                        mapping.bandType = std::stoi(parts[4]);
                        mapping.enabled = (parts[5] == "1");
                        mapping.multiplier = std::stof(parts[6]);
                        g_audioBandMappings.push_back(mapping);
                    }
                }
            }

            //Initialize loaded destinations
            InitializeOSCDestinations();
        }
        catch (std::exception& e) {
            std::cout << "Error loading config: " << e.what() << std::endl;
        }
    }

    // Load preset function
    void LoadPreset(int index) {
        if (g_presets.find(index) != g_presets.end()) {
            const OSCPreset& preset = g_presets[index];
            strcpy_s(g_config.oscIP, preset.ip.c_str());
            g_config.oscSendPort = preset.port;
            strcpy_s(g_config.oscAddress, preset.baseAddress.c_str());
            strcpy_s(g_config.presetName, preset.name.c_str());
            g_currentPresetIndex = index;
        }
    }

    // ===== ENGINE =====
    // Work that runs every frame no matter which interface is showing.

    static void EngineStart() {
        // Default file locations live in the data folder so RICO stays portable.
        std::string ae = Paths::DataDir() + "after-effects\\";
        CreateDirectoryA(ae.c_str(), nullptr);
        if (!g_aeRecState.path[0])
            strncpy_s(g_aeRecState.path, (ae + "recorded_performance.json").c_str(), _TRUNCATE);
        if (!g_aeRecState.livePath[0])
            strncpy_s(g_aeRecState.livePath, (ae + "live_params.jsx").c_str(), _TRUNCATE);
        if (!g_spoutState.sharedHandlePath[0])
            strncpy_s(g_spoutState.sharedHandlePath, Paths::DataFile("shared_handle.txt").c_str(), _TRUNCATE);

        InitializePresets();
        LoadConfig();
        InitializeMIDI();
        InitializeOSC();
        NetVideo_Init();

        if (g_pendingMidiBackend == (int)MidiBackend::WindowsMidi)
            SwitchMidiBackend(MidiBackend::WindowsMidi);
        const auto& transports = PluginHost_Transports();
        for (int i = 0; i < (int)transports.size(); ++i)
            if (transports[i].id == g_pendingTransportId && NetVideo_TransportAvailable(i))
                NetVideo_SelectTransport(i);
        for (const auto& name : g_pendingVirtualPorts)
            CreateNamedVirtualPort(name.c_str());

        if (g_config.receiveFromOSC)
            g_oscThread = std::thread(OSCReceiveThread);
    }

    static void EngineTick() {
        g_midiInConnected = (g_currentMidiBackend == MidiBackend::WindowsMidi)
            ? g_midiInConnected : (g_midiIn && g_midiIn->isPortOpen());
        g_midiOutConnected = (g_currentMidiBackend == MidiBackend::WindowsMidi)
            ? g_midiOutConnected : (g_midiOut && g_midiOut->isPortOpen());

        // Hardware device online watchdog
        float nowSec = (float)GetTickCount64() / 1000.0f;
        for (auto& dev : g_hwDevices)
            if (dev.lastSeen > 0 && nowSec - dev.lastSeen > 10.0f)
                dev.online = false;

        NetVideo_Receive();

        if (g_spoutState.receiverInitialized && g_spoutReceiver) {
            if (UpdateSpoutReceiver() && g_spoutState.exportSharedHandle)
                ExportSharedTextureHandle();
        }

        if (g_audioState.capturing)
            ProcessAudioToDisplays();

        if (g_guitarState.enabled && g_guitarSystem)
            g_guitarSystem->ProcessFrame();

        UpdateTimedSequences();
    }

    // Called after the frame is drawn, so window capture sees the new frame.
    static void EngineSendVideo() {
        NetVideo_SendFrame();
        SpoutSender_SendFrame();
    }

    static void EngineStop() {
        g_running = false;
        StopOSCReceive();
        if (g_oscThread.joinable())
            g_oscThread.join();

        if (g_guitarSystem) {
            delete g_guitarSystem;
            g_guitarSystem = nullptr;
        }

        SaveConfig();     // before the virtual ports are removed, so they are remembered
        DestroyNativeVirtualPorts();
        WinMidi_Shutdown();
        StopAudioCapture();
        CleanupSpout();
        NetVideo_Shutdown();
        MQTTDisconnect();
    }

    // ===== INTERFACES =====

    static bool g_webMode = false;
    static bool g_splash = false;      // the start screen is showing
    static DWORD g_splashStart = 0;

    static void RunClassicFrame(ImGuiIO& io) {
        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();

        bool fontPushed = g_dyslexiaFont && g_fontOpenDyslexic && (g_fontOpenDyslexic != g_fontDefault);
        if (fontPushed)
            ImGui::PushFont(g_fontOpenDyslexic);

        ImGui::SetNextWindowPos(ImVec2(0, 0));
        ImGui::SetNextWindowSize(io.DisplaySize);
        if (ImGui::Begin("RICO", nullptr,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_MenuBar)) {

            DrawApplicationMenuBar();

            if (ImGui::BeginTabBar("MainTabs")) {
                if (ImGui::BeginTabItem("Dashboard"))     { DrawDashboardTab();       ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("MIDI"))          { DrawMIDITab();            ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("OSC"))           { DrawOSCTab();             ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("DMX"))           { DrawDMXTab();             ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Spout"))         { DrawSpoutTab();           ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Network Video")) { DrawNetworkVideoTab();    ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("MQTT"))          { DrawMQTTTab();            ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Multimedia"))    { DrawMultimediaTab();      ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Audio"))         { DrawAudioAnalysisTab();   ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Ableton"))       { DrawAbletonLinkTab();     ImGui::EndTabItem(); }
                ImGui::EndTabBar();
            }

            DrawAccessibilityPopup();
            DrawHelpPopups();
        }
        ImGui::End();
        if (fontPushed)
            ImGui::PopFont();

        ImGui::Render();
        const float clear_color[4] = { 0.0f, 0.0f, 0.0f, 1.0f };
        g_pd3dDeviceContext->OMSetRenderTargets(1, &g_mainRenderTargetView, nullptr);
        g_pd3dDeviceContext->ClearRenderTargetView(g_mainRenderTargetView, clear_color);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
    }

    // Starts a fresh RICO and lets this one close. The new one waits until
    // this one has fully shut down (and removed its virtual ports) before it
    // starts, by waiting on a mutex this process holds until it exits.
    static void RestartApp(const char* args) {
        CreateMutexA(nullptr, TRUE, "Local\\RICO.restart");
        char exe[MAX_PATH] = {};
        GetModuleFileNameA(nullptr, exe, MAX_PATH);
        std::string full = std::string(args) + " --restart";
        ShellExecuteA(nullptr, "open", exe, full.c_str(), nullptr, SW_SHOWNORMAL);
    }

    static void WaitForPreviousInstance() {
        HANDLE m = OpenMutexA(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, "Local\\RICO.restart");
        if (!m) return;
        WaitForSingleObject(m, 8000);    // returns WAIT_ABANDONED when the old one exits
        ReleaseMutex(m);
        CloseHandle(m);
    }

    // Called from the classic interface's File menu.
    void SwitchToNewInterface() {
        g_config.classicUI = false;
        SaveConfig();
        RestartApp("--web");
        g_running = false;
    }

    // ===Entry point===
    int APIENTRY WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

        std::string cmdLine = lpCmdLine ? lpCmdLine : "";
        bool forceClassic = cmdLine.find("--classic") != std::string::npos;
        bool forceWeb = cmdLine.find("--web") != std::string::npos;
        bool allowNetwork = cmdLine.find("--allow-network") != std::string::npos;
        if (cmdLine.find("--restart") != std::string::npos)
            WaitForPreviousInstance();

        WNDCLASSEXW wc = { sizeof(wc), CS_CLASSDC, WndProc, 0L, 0L, GetModuleHandle(nullptr), nullptr, nullptr, nullptr, nullptr, L"RICO", nullptr };
        wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_RICO));
        wc.hIconSm = wc.hIcon;
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
        RegisterClassExW(&wc);
        RECT work{ 0, 0, 1440, 900 };
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
        const int winW = (std::min)(1440, (int)(work.right - work.left));
        const int winH = (std::min)(900, (int)(work.bottom - work.top));
        const int winX = work.left + ((work.right - work.left) - winW) / 2;
        const int winY = work.top + ((work.bottom - work.top) - winH) / 2;
        g_hWnd = CreateWindowW(wc.lpszClassName, L"RICO", WS_OVERLAPPEDWINDOW, winX, winY, winW, winH, nullptr, nullptr, wc.hInstance, nullptr);

        if (!CreateDeviceD3D(g_hWnd)) {
            CleanupDeviceD3D();
            MessageBoxW(nullptr, L"RICO needs DirectX 11. Please update your graphics driver.", L"RICO", MB_ICONERROR);
            UnregisterClassW(wc.lpszClassName, wc.hInstance);
            return 1;
        }

        // The new interface is the default. The classic one is used when asked
        // for, or when this PC can't show the new one. The window shows the
        // start screen right away, while the engine and the interface start.
        g_webMode = !forceClassic && (forceWeb || !g_config.classicUI);
        if (g_webMode) {
            std::string index = Paths::ExeDir() + "ui\\index.html";
            bool haveUi = GetFileAttributesA(index.c_str()) != INVALID_FILE_ATTRIBUTES;
            g_webMode = haveUi && WebShell_Available();
        }
        if (g_webMode) {
            g_splash = true;
            g_splashStart = GetTickCount();
            SetTimer(g_hWnd, 7701, 33, nullptr);
        }
        ShowWindow(g_hWnd, SW_SHOWDEFAULT);
        UpdateWindow(g_hWnd);

        // The engine first (MIDI, audio, video), with the start screen up.
        EngineStart();

        if (g_webMode) {
            g_webMode = Bridge_Start(allowNetwork || g_config.shareOnNetwork);
            if (g_webMode)
                g_webMode = WebShell_Create(g_hWnd, Bridge_Url());
            if (!g_webMode) {
                g_splash = false;
                LogInfo("Using the classic interface (WebView2 or the ui folder is missing).");
            }
        }

        // ImGui is always set up so we can fall back to it at any moment.
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO();
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        static std::string iniPath = Paths::DataFile("imgui.ini");
        io.IniFilename = iniPath.c_str();
        ImGui::StyleColorsDark();

        g_fontDefault = io.Fonts->AddFontDefault();
        g_fontOpenDyslexic = nullptr;
        {
            std::string fontPath = Paths::ExeDir() + "assets\\fonts\\OpenDyslexic-Regular.ttf";
            if (GetFileAttributesA(fontPath.c_str()) != INVALID_FILE_ATTRIBUTES)
                g_fontOpenDyslexic = io.Fonts->AddFontFromFileTTF(fontPath.c_str(), 22.0f);
        }
        if (!g_fontOpenDyslexic)
            g_fontOpenDyslexic = g_fontDefault;

        ImGui_ImplWin32_Init(g_hWnd);
        ImGui_ImplDX11_Init(g_pd3dDevice, g_pd3dDeviceContext);
        ApplyColorTheme();

        MSG msg = {};
        while (g_running && msg.message != WM_QUIT) {
            if (PeekMessage(&msg, nullptr, 0U, 0U, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessage(&msg);
                continue;
            }

            if (g_webMode && WebShell_Failed()) {
                LogInfo("The new interface could not start, switching to the classic one.");
                WebShell_Destroy();
                g_webMode = false;
            }

            EngineTick();

            if (g_webMode) {
                Bridge_Tick();
                EngineSendVideo();
                if (Bridge_RestartRequested()) {
                    RestartApp("--classic");
                    break;
                }
                // Nothing to draw ourselves. Wait for messages or ~60 Hz.
                MsgWaitForMultipleObjects(0, nullptr, FALSE, 8, QS_ALLINPUT);
            } else {
                RunClassicFrame(io);
                EngineSendVideo();
                g_pSwapChain->Present(1, 0);
            }
        }

        WebShell_Destroy();
        Bridge_Stop();
        EngineStop();

        ImGui_ImplDX11_Shutdown();
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext();

        CleanupDeviceD3D();
        DestroyWindow(g_hWnd);
        UnregisterClassW(wc.lpszClassName, wc.hInstance);
        CoUninitialize();
        return 0;
    }

    // Helper functions for D3D 
    bool CreateDeviceD3D(HWND hWnd) {
        DXGI_SWAP_CHAIN_DESC sd = {};

        sd.BufferCount = 2;
        sd.BufferDesc.Width = 0;
        sd.BufferDesc.Height = 0;
        sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        sd.BufferDesc.RefreshRate.Numerator = 60;
        sd.BufferDesc.RefreshRate.Denominator = 1;
        sd.Flags = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
        sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        sd.OutputWindow = hWnd;
        sd.SampleDesc.Count = 1;
        sd.SampleDesc.Quality = 0;
        sd.Windowed = TRUE;
        sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

        UINT createDeviceFlags = 0;
        D3D_FEATURE_LEVEL featureLevel;
        const D3D_FEATURE_LEVEL featureLevelArray[2] = { D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0 };

        HRESULT res = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, createDeviceFlags, featureLevelArray, 2, D3D11_SDK_VERSION, &sd, &g_pSwapChain, &g_pd3dDevice, &featureLevel, &g_pd3dDeviceContext);
        if (res == DXGI_ERROR_UNSUPPORTED)
            res = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, createDeviceFlags, featureLevelArray, 2, D3D11_SDK_VERSION, &sd, &g_pSwapChain, &g_pd3dDevice, &featureLevel, &g_pd3dDeviceContext);
        if (res != S_OK)
            return false;

        CreateRenderTarget();
        return true;
    }

    void CleanupDeviceD3D() {
        CleanupRenderTarget();
        if (g_pSwapChain) { g_pSwapChain->Release(); g_pSwapChain = nullptr; }
        if (g_pd3dDeviceContext) { g_pd3dDeviceContext->Release(); g_pd3dDeviceContext = nullptr; }
        if (g_pd3dDevice) { g_pd3dDevice->Release(); g_pd3dDevice = nullptr; }
    }

    void CreateRenderTarget() {
        ID3D11Texture2D* pBackBuffer;
        g_pSwapChain->GetBuffer(0, IID_PPV_ARGS(&pBackBuffer));
        g_pd3dDevice->CreateRenderTargetView(pBackBuffer, nullptr, &g_mainRenderTargetView);
        pBackBuffer->Release();
    }

    void CleanupRenderTarget() {
        if (g_mainRenderTargetView) { g_mainRenderTargetView->Release(); g_mainRenderTargetView = nullptr; }
    }

    // The start screen, drawn by the window itself while the interface loads:
    // RICO in its own letters, a blinking cursor and a moving bar, on black.
    static HFONT SplashFont(int px, bool title) {
        static HFONT fontTitle = nullptr, fontText = nullptr;  // not "small": Windows defines it
        HFONT& f = title ? fontTitle : fontText;
        if (!f) {
            static bool added = false;
            if (!added) {
                added = true;
                std::string tt = Paths::ExeDir() + "ui\\fonts\\Teletactile.ttf";
                AddFontResourceExA(tt.c_str(), FR_PRIVATE, nullptr);
            }
            f = CreateFontW(-px, 0, 0, 0, title ? FW_BOLD : FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                            CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY, DEFAULT_PITCH, L"Teletactile");
        }
        return f;
    }
    static void PaintSplash(HWND hWnd, HDC dc) {
        RECT r; GetClientRect(hWnd, &r);
        HDC mem = CreateCompatibleDC(dc);
        HBITMAP bmp = CreateCompatibleBitmap(dc, r.right, r.bottom);
        HGDIOBJ old = SelectObject(mem, bmp);
        FillRect(mem, &r, (HBRUSH)GetStockObject(BLACK_BRUSH));
        SetBkMode(mem, TRANSPARENT);
        const int cx = r.right / 2, cy = r.bottom / 2;
        const DWORD t = GetTickCount() - g_splashStart;
        // the word
        SelectObject(mem, SplashFont((std::max)(48, (int)r.bottom / 9), true));
        SetTextColor(mem, RGB(255, 255, 255));
        SIZE sz; GetTextExtentPoint32W(mem, L"RICO", 4, &sz);
        const int tx = cx - sz.cx / 2 - sz.cy / 6, ty = cy - sz.cy;
        TextOutW(mem, tx, ty, L"RICO", 4);
        // the cursor, blinking
        if ((t / 500) % 2 == 0) {
            RECT cur = { tx + sz.cx + sz.cy / 10, ty + sz.cy * 78 / 100, tx + sz.cx + sz.cy / 10 + sz.cy / 3, ty + sz.cy * 88 / 100 };
            HBRUSH lime = CreateSolidBrush(RGB(59, 255, 3)); FillRect(mem, &cur, lime); DeleteObject(lime);
        }
        // the line under it, with a block running along it
        const int w = (std::max)(160, (int)sz.cx), y = cy + (int)sz.cy / 3;
        RECT line = { cx - w / 2, y, cx + w / 2, y + 2 };
        HBRUSH dim = CreateSolidBrush(RGB(20, 60, 12)); FillRect(mem, &line, dim); DeleteObject(dim);
        const int bw = w / 5, pos = (int)((t % 1400) * (w + bw) / 1400) - bw;
        RECT bar = { cx - w / 2 + (std::max)(0, pos), y - 1, cx - w / 2 + (std::min)(w, pos + bw), y + 3 };
        if (bar.right > bar.left) { HBRUSH lime = CreateSolidBrush(RGB(59, 255, 3)); FillRect(mem, &bar, lime); DeleteObject(lime); }
        // what it is doing
        SelectObject(mem, SplashFont(13, false));
        SetTextColor(mem, RGB(120, 160, 110));
        const wchar_t* msg = L"STARTING";
        SIZE ms; GetTextExtentPoint32W(mem, msg, (int)wcslen(msg), &ms);
        TextOutW(mem, cx - ms.cx / 2, y + 18, msg, (int)wcslen(msg));
        BitBlt(dc, 0, 0, r.right, r.bottom, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem);
    }

    LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
        if (!g_webMode && ImGui::GetCurrentContext() && ImGui_ImplWin32_WndProcHandler(hWnd, msg, wParam, lParam))
            return true;

        switch (msg) {
        case WM_PAINT:
            if (g_splash) {
                PAINTSTRUCT ps;
                HDC dc = BeginPaint(hWnd, &ps);
                PaintSplash(hWnd, dc);
                EndPaint(hWnd, &ps);
                return 0;
            }
            break;
        case WM_ERASEBKGND:
            if (g_splash) return 1;
            break;
        case WM_TIMER:
            if (wParam == 7701) {
                if (!g_splash || WebShell_Shown() || GetTickCount() - g_splashStart > 30000) { g_splash = false; KillTimer(hWnd, 7701); }
                InvalidateRect(hWnd, nullptr, FALSE);
                return 0;
            }
            break;
        case WM_SIZE:
            if (g_pd3dDevice != nullptr && wParam != SIZE_MINIMIZED) {
                CleanupRenderTarget();
                g_pSwapChain->ResizeBuffers(0, (UINT)LOWORD(lParam), (UINT)HIWORD(lParam), DXGI_FORMAT_UNKNOWN, 0);
                CreateRenderTarget();
            }
            WebShell_Resize(hWnd);
            return 0;
        case WM_DPICHANGED: {
            // Moved to a screen with a different scale: use the size Windows suggests,
            // otherwise part of the window ends up off screen.
            const RECT* r = (const RECT*)lParam;
            SetWindowPos(hWnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_GETMINMAXINFO: {
            MINMAXINFO* mmi = (MINMAXINFO*)lParam;
            mmi->ptMinTrackSize.x = 960;
            mmi->ptMinTrackSize.y = 600;
            return 0;
        }
        case WM_SYSCOMMAND:
            if ((wParam & 0xfff0) == SC_KEYMENU)
                return 0;
            break;
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
        }
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }
