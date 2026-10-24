/*
 * RICO plugin API
 *
 * A RICO plugin is a DLL placed in the "plugins" folder next to RICO.exe.
 * RICO looks for two exported C functions:
 *
 *   const RicoPluginInfo*  rico_plugin_info(void);
 *   const RicoVideoTransportApi* rico_plugin_video_transport(void);   (optional)
 *
 * The API is plain C so plugins can be built with any compiler.
 * Video frames are always 8-bit BGRA in system memory.
 */
#ifndef RICO_PLUGIN_API_H
#define RICO_PLUGIN_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RICO_PLUGIN_API_VERSION 1

#if defined(_WIN32)
#  define RICO_PLUGIN_EXPORT __declspec(dllexport)
#else
#  define RICO_PLUGIN_EXPORT __attribute__((visibility("default")))
#endif

typedef struct RicoPluginInfo {
    int         api_version;   /* RICO_PLUGIN_API_VERSION */
    const char* id;            /* short, unique, lowercase: "ndi" */
    const char* name;          /* shown in the UI: "NDI" */
    const char* version;       /* plugin version: "1.0.0" */
    const char* description;   /* one sentence */
    const char* homepage;      /* where users get the runtime it needs, may be NULL */
} RicoPluginInfo;

typedef struct RicoVideoFrame {
    int            width;
    int            height;
    int            stride;     /* bytes per row */
    const uint8_t* data;       /* BGRA */
    int            fps_num;    /* e.g. 60000 */
    int            fps_den;    /* e.g. 1000  */
} RicoVideoFrame;

/* Called by a transport when a received frame is ready. The frame is only
 * valid for the duration of the call. */
typedef void (*RicoFrameCallback)(const RicoVideoFrame* frame, void* user);

typedef struct RicoVideoTransportApi {
    int api_version;

    /* 1 when the transport can run on this computer (runtime found, etc.).
     * When 0, status_text() should say why. */
    int         (*is_available)(void);
    const char* (*status_text)(void);

    int  (*start)(void);   /* load runtimes, return 1 on success */
    void (*stop)(void);

    /* Sending */
    int  (*sender_open)(const char* name);
    void (*sender_close)(void);
    int  (*sender_send)(const RicoVideoFrame* frame);

    /* Receiving. find_sources fills names separated by '\n' into buf
     * and returns the number of sources. */
    int  (*find_sources)(char* buf, int buf_size);
    int  (*receiver_open)(const char* source_name);
    void (*receiver_close)(void);
    /* Polls for one frame, calls cb if a new one arrived. Returns 1 if a frame was delivered. */
    int  (*receiver_poll)(RicoFrameCallback cb, void* user);
} RicoVideoTransportApi;

typedef const RicoPluginInfo*        (*RicoPluginInfoFn)(void);
typedef const RicoVideoTransportApi* (*RicoPluginVideoTransportFn)(void);

#ifdef __cplusplus
}
#endif

#endif /* RICO_PLUGIN_API_H */
