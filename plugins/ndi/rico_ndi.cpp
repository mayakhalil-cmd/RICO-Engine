// NDI plugin for RICO.
//
// RICO never links against NDI. This plugin looks for the NDI runtime that
// the user installed (NDI Tools or the NDI Runtime installer), loads it at
// runtime and exposes it through the RICO video transport API. If the
// runtime is missing, the plugin reports that and RICO keeps running.
//
// NDI(R) is a registered trademark of Vizrt NDI AB. https://ndi.video

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "Processing.NDI.Lib.h"
#include "rico/plugin_api.h"

namespace {

HMODULE          g_lib = nullptr;
const NDIlib_v6* g_ndi = nullptr;
bool             g_initialized = false;
std::string      g_status = "Not started";

NDIlib_send_instance_t g_sender = nullptr;
NDIlib_recv_instance_t g_receiver = nullptr;
NDIlib_find_instance_t g_finder = nullptr;

std::string runtimePath() {
    char dir[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA(NDILIB_REDIST_FOLDER, dir, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) return NDILIB_LIBRARY_NAME;
    std::string path(dir);
    if (!path.empty() && path.back() != '\\' && path.back() != '/') path += '\\';
    return path + NDILIB_LIBRARY_NAME;
}

bool loadRuntime() {
    if (g_ndi) return true;

    std::string path = runtimePath();
    g_lib = LoadLibraryA(path.c_str());
    if (!g_lib) g_lib = LoadLibraryA(NDILIB_LIBRARY_NAME);
    if (!g_lib) {
        g_status = "NDI runtime not found. Install NDI Tools from ndi.video, then restart RICO.";
        return false;
    }

    using LoadV6 = const NDIlib_v6* (*)(void);
    auto load = reinterpret_cast<LoadV6>(GetProcAddress(g_lib, "NDIlib_v6_load"));
    if (!load) load = reinterpret_cast<LoadV6>(GetProcAddress(g_lib, "NDIlib_v5_load"));
    if (!load) {
        g_status = "The installed NDI runtime is too old. Please update NDI Tools.";
        FreeLibrary(g_lib);
        g_lib = nullptr;
        return false;
    }

    g_ndi = load();
    if (!g_ndi) {
        g_status = "The NDI runtime could not be loaded.";
        FreeLibrary(g_lib);
        g_lib = nullptr;
        return false;
    }
    return true;
}

// ---- transport functions -------------------------------------------------

int isAvailable() {
    if (g_ndi) return 1;
    // A cheap check that doesn't keep the library loaded.
    std::string path = runtimePath();
    HMODULE probe = LoadLibraryExA(path.c_str(), nullptr, LOAD_LIBRARY_AS_DATAFILE);
    if (!probe) probe = LoadLibraryExA(NDILIB_LIBRARY_NAME, nullptr, LOAD_LIBRARY_AS_DATAFILE);
    if (!probe) {
        g_status = "NDI runtime not found. Install NDI Tools from ndi.video, then restart RICO.";
        return 0;
    }
    FreeLibrary(probe);
    if (!g_initialized) g_status = "Ready";
    return 1;
}

const char* statusText() { return g_status.c_str(); }

int start() {
    if (g_initialized) return 1;
    if (!loadRuntime()) return 0;
    if (!g_ndi->initialize()) {
        g_status = "This CPU is not supported by NDI.";
        return 0;
    }
    g_initialized = true;
    g_status = "Running";
    return 1;
}

void senderClose();
void receiverClose();

void stop() {
    senderClose();
    receiverClose();
    if (g_finder) { g_ndi->find_destroy(g_finder); g_finder = nullptr; }
    if (g_initialized) { g_ndi->destroy(); g_initialized = false; }
    g_ndi = nullptr;
    if (g_lib) { FreeLibrary(g_lib); g_lib = nullptr; }
    g_status = "Stopped";
}

int senderOpen(const char* name) {
    if (!start()) return 0;
    senderClose();
    NDIlib_send_create_t desc;
    desc.p_ndi_name = name;
    desc.p_groups = nullptr;
    desc.clock_video = false;
    desc.clock_audio = false;
    g_sender = g_ndi->send_create(&desc);
    return g_sender ? 1 : 0;
}

void senderClose() {
    if (g_sender && g_ndi) g_ndi->send_destroy(g_sender);
    g_sender = nullptr;
}

int senderSend(const RicoVideoFrame* f) {
    if (!g_sender || !f || !f->data) return 0;
    NDIlib_video_frame_v2_t frame;
    frame.xres = f->width;
    frame.yres = f->height;
    frame.FourCC = NDIlib_FourCC_type_BGRA;
    frame.frame_rate_N = f->fps_num > 0 ? f->fps_num : 60000;
    frame.frame_rate_D = f->fps_den > 0 ? f->fps_den : 1000;
    frame.picture_aspect_ratio = (float)f->width / (float)f->height;
    frame.frame_format_type = NDIlib_frame_format_type_progressive;
    frame.timecode = NDIlib_send_timecode_synthesize;
    frame.p_data = const_cast<uint8_t*>(f->data);
    frame.line_stride_in_bytes = f->stride;
    frame.p_metadata = nullptr;
    frame.timestamp = 0;
    g_ndi->send_send_video_v2(g_sender, &frame);
    return 1;
}

int findSources(char* buf, int size) {
    if (!start()) return 0;
    if (!g_finder) {
        NDIlib_find_create_t desc;
        desc.show_local_sources = true;
        desc.p_groups = nullptr;
        desc.p_extra_ips = nullptr;
        g_finder = g_ndi->find_create_v2(&desc);
        if (!g_finder) return 0;
        g_ndi->find_wait_for_sources(g_finder, 1000);
    }
    uint32_t count = 0;
    const NDIlib_source_t* sources = g_ndi->find_get_current_sources(g_finder, &count);

    std::string list;
    for (uint32_t i = 0; i < count; ++i) {
        if (i) list += '\n';
        list += sources[i].p_ndi_name;
    }
    if (buf && size > 0) {
        strncpy_s(buf, size, list.c_str(), _TRUNCATE);
    }
    return (int)count;
}

int receiverOpen(const char* sourceName) {
    if (!start()) return 0;
    receiverClose();

    NDIlib_source_t source;
    source.p_ndi_name = sourceName;
    source.p_url_address = nullptr;

    NDIlib_recv_create_v3_t desc;
    desc.source_to_connect_to = source;
    desc.color_format = NDIlib_recv_color_format_BGRX_BGRA;
    desc.bandwidth = NDIlib_recv_bandwidth_highest;
    desc.allow_video_fields = false;
    desc.p_ndi_recv_name = "RICO";
    g_receiver = g_ndi->recv_create_v3(&desc);
    return g_receiver ? 1 : 0;
}

void receiverClose() {
    if (g_receiver && g_ndi) g_ndi->recv_destroy(g_receiver);
    g_receiver = nullptr;
}

int receiverPoll(RicoFrameCallback cb, void* user) {
    if (!g_receiver) return 0;
    NDIlib_video_frame_v2_t video;
    if (g_ndi->recv_capture_v2(g_receiver, &video, nullptr, nullptr, 0) != NDIlib_frame_type_video)
        return 0;

    RicoVideoFrame f;
    f.width = video.xres;
    f.height = video.yres;
    f.stride = video.line_stride_in_bytes;
    f.data = video.p_data;
    f.fps_num = video.frame_rate_N;
    f.fps_den = video.frame_rate_D;
    if (cb) cb(&f, user);

    g_ndi->recv_free_video_v2(g_receiver, &video);
    return 1;
}

const RicoPluginInfo kInfo = {
    RICO_PLUGIN_API_VERSION,
    "ndi",
    "NDI",
    "1.0.0",
    "Send and receive video over the network with NDI. Needs the free NDI runtime.",
    "https://ndi.video/tools/",
};

const RicoVideoTransportApi kApi = {
    RICO_PLUGIN_API_VERSION,
    isAvailable, statusText,
    start, stop,
    senderOpen, senderClose, senderSend,
    findSources, receiverOpen, receiverClose, receiverPoll,
};

} // namespace

extern "C" RICO_PLUGIN_EXPORT const RicoPluginInfo* rico_plugin_info(void) { return &kInfo; }
extern "C" RICO_PLUGIN_EXPORT const RicoVideoTransportApi* rico_plugin_video_transport(void) { return &kApi; }
