#include "src/video/PluginHost.h"
#include "src/video/OmtTransport.h"
#include "src/common/Paths.h"

namespace {
std::vector<VideoTransport> g_transports;
std::vector<PluginProblem>  g_problems;

VideoTransport fromInfo(const RicoPluginInfo* info, const RicoVideoTransportApi* api) {
    VideoTransport t;
    t.id = info->id ? info->id : "";
    t.name = info->name ? info->name : t.id;
    t.version = info->version ? info->version : "";
    t.description = info->description ? info->description : "";
    t.homepage = info->homepage ? info->homepage : "";
    t.api = api;
    return t;
}

bool alreadyHave(const std::string& id) {
    for (const auto& t : g_transports)
        if (t.id == id) return true;
    return false;
}

void loadPlugin(const std::string& folder, const std::string& file) {
    std::string path = folder + file;
    HMODULE mod = LoadLibraryExA(path.c_str(), nullptr,
                                 LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (!mod) {
        g_problems.push_back({ file, "Windows could not load this file." });
        return;
    }

    auto infoFn = reinterpret_cast<RicoPluginInfoFn>(GetProcAddress(mod, "rico_plugin_info"));
    auto videoFn = reinterpret_cast<RicoPluginVideoTransportFn>(GetProcAddress(mod, "rico_plugin_video_transport"));
    const RicoPluginInfo* info = infoFn ? infoFn() : nullptr;

    if (!info) {
        g_problems.push_back({ file, "Not a RICO plugin." });
        FreeLibrary(mod);
        return;
    }
    if (info->api_version != RICO_PLUGIN_API_VERSION) {
        g_problems.push_back({ file, "Made for a different version of RICO." });
        FreeLibrary(mod);
        return;
    }
    const RicoVideoTransportApi* api = videoFn ? videoFn() : nullptr;
    if (!api || api->api_version != RICO_PLUGIN_API_VERSION) {
        g_problems.push_back({ file, "Plugin has no video transport." });
        FreeLibrary(mod);
        return;
    }
    if (info->id && alreadyHave(info->id)) {
        g_problems.push_back({ file, "Another plugin with the same id is already loaded." });
        FreeLibrary(mod);
        return;
    }

    VideoTransport t = fromInfo(info, api);
    t.file = file;
    t.module = mod;
    g_transports.push_back(t);
}
} // namespace

std::string PluginHost_Folder() {
    return Paths::ExeDir() + "plugins\\";
}

void PluginHost_Scan() {
    PluginHost_Unload();

    VideoTransport omt = fromInfo(OmtTransportInfo(), OmtTransportApi());
    omt.builtIn = true;
    g_transports.push_back(omt);

    std::string folder = PluginHost_Folder();
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA((folder + "rico-*.dll").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return;
    do {
        if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
            loadPlugin(folder, fd.cFileName);
    } while (FindNextFileA(h, &fd));
    FindClose(h);
}

void PluginHost_Unload() {
    for (auto& t : g_transports) {
        if (t.api) t.api->stop();
        if (t.module) FreeLibrary(t.module);
    }
    g_transports.clear();
    g_problems.clear();
}

const std::vector<VideoTransport>& PluginHost_Transports() { return g_transports; }
const std::vector<PluginProblem>& PluginHost_Problems() { return g_problems; }
