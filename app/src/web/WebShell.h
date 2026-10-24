#pragma once
#include <windows.h>
#include <string>

// Hosts the RICO interface inside the main window with Microsoft Edge
// WebView2. WebView2 ships with Windows 11 (and most Windows 10 PCs).
//
// WebShell_Create returns false when the runtime is missing so RICO can fall
// back to the classic interface.

bool WebShell_Available();
bool WebShell_Create(HWND parent, const std::string& url);
void WebShell_Resize(HWND parent);
void WebShell_Destroy();
bool WebShell_Failed();
bool WebShell_Shown();   // the interface has started to show (the start screen can go)
void WebShell_SetZoom(double z);   // the size of the whole interface, like Ctrl + and - in a browser
double WebShell_Zoom();
