#include "src/common/Paths.h"

#include <windows.h>
#include <shlobj.h>

namespace {
bool canWrite(const std::string& dir) {
    CreateDirectoryA(dir.c_str(), nullptr);
    std::string probe = dir + ".write-test";
    HANDLE h = CreateFileA(probe.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    CloseHandle(h);
    return true;
}
}

namespace Paths {

std::string ExeDir() {
    static std::string dir;
    if (dir.empty()) {
        char path[MAX_PATH] = {};
        GetModuleFileNameA(nullptr, path, MAX_PATH);
        dir = path;
        size_t slash = dir.find_last_of("\\/");
        dir = (slash == std::string::npos) ? std::string(".\\") : dir.substr(0, slash + 1);
    }
    return dir;
}

std::string DataDir() {
    static std::string dir;
    if (!dir.empty()) return dir;

    std::string portable = ExeDir() + "data\\";
    if (canWrite(portable)) {
        dir = portable;
        return dir;
    }

    char appdata[MAX_PATH] = {};
    if (SUCCEEDED(SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        dir = std::string(appdata) + "\\RICO\\";
        CreateDirectoryA(dir.c_str(), nullptr);
    } else {
        dir = portable;
    }
    return dir;
}

std::string DataFile(const char* name) {
    return DataDir() + name;
}

}
