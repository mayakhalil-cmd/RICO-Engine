#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct ID3D11ShaderResourceView;

// Network video: send and receive video over the network through any
// transport (OMT built in, NDI and others as plugins).

enum class NetVideoSource {
    Window = 0,     // the RICO window
    Screen = 1,     // a whole monitor
    Passthrough = 2,// re-send what we are receiving
    Canvas = 3,     // frames from the Create workspace
    Spout = 4,      // the Spout sender RICO is receiving (Blender, Unreal, ...)
};

struct NetVideoState {
    int  transport = 0;                 // index into PluginHost_Transports()
    bool sending = false;
    NetVideoSource source = NetVideoSource::Window;
    int  monitor = 0;
    char senderName[64] = "RICO";
    int  width = 0;
    int  height = 0;

    bool receiving = false;
    char sourceName[256] = "";
    int  receivedWidth = 0;
    int  receivedHeight = 0;
    bool bridgeToSpout = false;         // re-publish received video as a Spout sender
    char spoutBridgeName[64] = "RICO Network In";

    std::string lastError;
};

extern NetVideoState g_netVideo;

void NetVideo_Init();
void NetVideo_Shutdown();

bool NetVideo_SelectTransport(int index);
const char* NetVideo_TransportName();
const char* NetVideo_TransportStatus();
bool NetVideo_TransportAvailable(int index);

bool NetVideo_StartSending();
void NetVideo_StopSending();
bool NetVideo_SetSource(NetVideoSource source, int monitor = 0);

// Call once per frame after the RICO window has been drawn.
void NetVideo_SendFrame();

// Frames coming from the Create workspace (RGBA, top-down).
void NetVideo_SubmitCanvasFrame(const uint8_t* rgba, int width, int height);
// Latest Create workspace frame as BGRA, or nullptr if there is none yet.
const uint8_t* NetVideo_CanvasFrame(int& width, int& height);

void NetVideo_RefreshSources();
const std::vector<std::string>& NetVideo_Sources();
bool NetVideo_Connect(const char* sourceName);
void NetVideo_Disconnect();

// Call once per frame. Returns true when a new frame arrived.
bool NetVideo_Receive();
ID3D11ShaderResourceView* NetVideo_ReceivedSRV();
