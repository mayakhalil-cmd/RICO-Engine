// Open Media Transport (OMT) support.
//
// OMT is an open, MIT licensed protocol for sending video over a network.
// RICO loads libomt.dll at runtime (it ships next to RICO.exe), so a missing
// or broken copy only disables OMT instead of stopping the app.
// https://github.com/openmediatransport

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <cstring>
#include <string>

#include "libomt.h"
#include "rico/plugin_api.h"
#include "src/video/OmtTransport.h"

namespace {

struct OmtFns {
    char** (*discovery_getaddresses)(int*);
    omt_receive_t* (*receive_create)(const char*, OMTFrameType, OMTPreferredVideoFormat, OMTReceiveFlags);
    void (*receive_destroy)(omt_receive_t*);
    OMTMediaFrame* (*receive)(omt_receive_t*, OMTFrameType, int);
    omt_send_t* (*send_create)(const char*, OMTQuality);
    void (*send_setsenderinformation)(omt_send_t*, OMTSenderInfo*);
    void (*send_destroy)(omt_send_t*);
    int (*send)(omt_send_t*, OMTMediaFrame*);
};

HMODULE        g_lib = nullptr;
OmtFns         g_fn = {};
bool           g_started = false;
std::string    g_status = "Not started";
omt_send_t*    g_sender = nullptr;
omt_receive_t* g_receiver = nullptr;

std::string exeDir() {
    char path[MAX_PATH] = {};
    GetModuleFileNameA(nullptr, path, MAX_PATH);
    std::string p(path);
    size_t slash = p.find_last_of("\\/");
    return slash == std::string::npos ? std::string() : p.substr(0, slash + 1);
}

template <typename T>
bool bind(T& fn, const char* name) {
    fn = reinterpret_cast<T>(GetProcAddress(g_lib, name));
    return fn != nullptr;
}

bool loadLibrary() {
    if (g_lib) return true;
    // libomt finds libvmx (the video codec) in the same folder by itself.
    g_lib = LoadLibraryA((exeDir() + "libomt.dll").c_str());
    if (!g_lib) {
        g_status = "libomt.dll was not found next to RICO.exe.";
        return false;
    }
    bool ok = bind(g_fn.discovery_getaddresses, "omt_discovery_getaddresses")
           && bind(g_fn.receive_create, "omt_receive_create")
           && bind(g_fn.receive_destroy, "omt_receive_destroy")
           && bind(g_fn.receive, "omt_receive")
           && bind(g_fn.send_create, "omt_send_create")
           && bind(g_fn.send_setsenderinformation, "omt_send_setsenderinformation")
           && bind(g_fn.send_destroy, "omt_send_destroy")
           && bind(g_fn.send, "omt_send");
    if (!ok) {
        g_status = "libomt.dll is a different version than RICO expects.";
        FreeLibrary(g_lib);
        g_lib = nullptr;
        return false;
    }
    return true;
}

int isAvailable() {
    if (g_lib) return 1;
    std::string path = exeDir() + "libomt.dll";
    if (GetFileAttributesA(path.c_str()) == INVALID_FILE_ATTRIBUTES) {
        g_status = "libomt.dll was not found next to RICO.exe.";
        return 0;
    }
    if (!g_started) g_status = "Ready";
    return 1;
}

const char* statusText() { return g_status.c_str(); }

int start() {
    if (g_started) return 1;
    if (!loadLibrary()) return 0;
    g_started = true;
    g_status = "Running";
    return 1;
}

void senderClose() {
    if (g_sender) g_fn.send_destroy(g_sender);
    g_sender = nullptr;
}

void receiverClose() {
    if (g_receiver) g_fn.receive_destroy(g_receiver);
    g_receiver = nullptr;
}

void stop() {
    if (!g_started) return;
    senderClose();
    receiverClose();
    g_started = false;
    g_status = "Stopped";
}

int senderOpen(const char* name) {
    if (!start()) return 0;
    senderClose();
    g_sender = g_fn.send_create(name, OMTQuality_Default);
    if (!g_sender) return 0;

    OMTSenderInfo info = {};
    strncpy_s(info.ProductName, sizeof(info.ProductName), "RICO", _TRUNCATE);
    strncpy_s(info.Manufacturer, sizeof(info.Manufacturer), "RICO", _TRUNCATE);
    strncpy_s(info.Version, sizeof(info.Version), "3.0", _TRUNCATE);
    g_fn.send_setsenderinformation(g_sender, &info);
    return 1;
}

int senderSend(const RicoVideoFrame* f) {
    if (!g_sender || !f || !f->data) return 0;
    OMTMediaFrame frame = {};
    frame.Type = OMTFrameType_Video;
    frame.Timestamp = -1;   // let OMT stamp the frame
    frame.Codec = OMTCodec_BGRA;
    frame.Width = f->width;
    frame.Height = f->height;
    frame.Stride = f->stride;
    frame.Flags = OMTVideoFlags_None;
    frame.FrameRateN = f->fps_num > 0 ? f->fps_num : 60000;
    frame.FrameRateD = f->fps_den > 0 ? f->fps_den : 1000;
    frame.AspectRatio = (float)f->width / (float)f->height;
    frame.ColorSpace = OMTColorSpace_BT709;
    frame.Data = const_cast<uint8_t*>(f->data);
    frame.DataLength = f->stride * f->height;
    return g_fn.send(g_sender, &frame) >= 0 ? 1 : 0;
}

int findSources(char* buf, int size) {
    if (!start()) return 0;
    int count = 0;
    char** list = g_fn.discovery_getaddresses(&count);
    std::string out;
    for (int i = 0; i < count && list; ++i) {
        if (i) out += '\n';
        out += list[i];
    }
    if (buf && size > 0) strncpy_s(buf, size, out.c_str(), _TRUNCATE);
    return count;
}

int receiverOpen(const char* address) {
    if (!start()) return 0;
    receiverClose();
    g_receiver = g_fn.receive_create(address, OMTFrameType_Video, OMTPreferredVideoFormat_BGRA, OMTReceiveFlags_None);
    return g_receiver ? 1 : 0;
}

int receiverPoll(RicoFrameCallback cb, void* user) {
    if (!g_receiver) return 0;
    OMTMediaFrame* frame = g_fn.receive(g_receiver, OMTFrameType_Video, 0);
    if (!frame || frame->Type != OMTFrameType_Video || frame->Codec != OMTCodec_BGRA || !frame->Data)
        return 0;

    RicoVideoFrame f;
    f.width = frame->Width;
    f.height = frame->Height;
    f.stride = frame->Stride;
    f.data = static_cast<const uint8_t*>(frame->Data);
    f.fps_num = frame->FrameRateN;
    f.fps_den = frame->FrameRateD;
    if (cb) cb(&f, user);
    return 1;
}

const RicoPluginInfo kInfo = {
    RICO_PLUGIN_API_VERSION,
    "omt",
    "OMT",
    "1.0.0",
    "Open Media Transport. Open source network video, built into RICO.",
    "https://github.com/openmediatransport",
};

const RicoVideoTransportApi kApi = {
    RICO_PLUGIN_API_VERSION,
    isAvailable, statusText,
    start, stop,
    senderOpen, senderClose, senderSend,
    findSources, receiverOpen, receiverClose, receiverPoll,
};

} // namespace

const RicoPluginInfo* OmtTransportInfo() { return &kInfo; }
const RicoVideoTransportApi* OmtTransportApi() { return &kApi; }
