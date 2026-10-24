#pragma once
#include <string>
#include <vector>
#include <windows.h>

#include "rico/plugin_api.h"

// One video transport RICO can use: OMT is built in, the rest come from
// DLLs in the "plugins" folder next to RICO.exe.
struct VideoTransport {
    std::string id;
    std::string name;
    std::string version;
    std::string description;
    std::string homepage;
    std::string file;          // empty for built-in transports
    bool builtIn = false;
    const RicoVideoTransportApi* api = nullptr;
    HMODULE module = nullptr;
};

// Information about a plugin file that could not be loaded, so the UI can
// explain it instead of silently hiding it.
struct PluginProblem {
    std::string file;
    std::string reason;
};

void PluginHost_Scan();
void PluginHost_Unload();

const std::vector<VideoTransport>& PluginHost_Transports();
const std::vector<PluginProblem>&  PluginHost_Problems();
std::string PluginHost_Folder();
