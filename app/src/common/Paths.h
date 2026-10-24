#pragma once
#include <string>

// RICO is portable: settings live in a "data" folder next to RICO.exe so the
// whole app can run from a USB stick. If that folder can't be written to
// (for example inside Program Files), RICO falls back to %APPDATA%\RICO.
namespace Paths {
std::string ExeDir();     // ends with a backslash
std::string DataDir();    // ends with a backslash, created on first use
std::string DataFile(const char* name);
}
