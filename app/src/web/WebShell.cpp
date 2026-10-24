#include "src/web/WebShell.h"
#include "src/common/Paths.h"

#ifndef RICO_WITH_WEBVIEW

bool WebShell_Available() { return false; }
bool WebShell_Create(HWND, const std::string&) { return false; }
bool WebShell_Shown() { return true; }
void WebShell_Resize(HWND) {}
void WebShell_Destroy() {}
bool WebShell_Failed() { return true; }
void WebShell_SetZoom(double) {}
double WebShell_Zoom() { return 1.0; }

#else

#include <shellapi.h>
#include <wrl.h>
#include <WebView2.h>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_view;
std::wstring g_home;
bool g_shown = false;
bool g_failed = false;

// Full screen: the page asks for it (F11, the preview's full screen button),
// WebView2 tells us, and we make the window cover the whole monitor.
HWND g_parent = nullptr;
bool g_fullscreen = false;
LONG_PTR g_savedStyle = 0;
RECT g_savedRect{};

void setFullscreen(bool on) {
    if (!g_parent || on == g_fullscreen) return;
    g_fullscreen = on;
    if (on) {
        g_savedStyle = GetWindowLongPtrW(g_parent, GWL_STYLE);
        GetWindowRect(g_parent, &g_savedRect);
        MONITORINFO mi{ sizeof(mi) };
        GetMonitorInfoW(MonitorFromWindow(g_parent, MONITOR_DEFAULTTONEAREST), &mi);
        SetWindowLongPtrW(g_parent, GWL_STYLE, g_savedStyle & ~(WS_CAPTION | WS_THICKFRAME));
        SetWindowPos(g_parent, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top,
                     mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
                     SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        SetWindowLongPtrW(g_parent, GWL_STYLE, g_savedStyle);
        SetWindowPos(g_parent, nullptr, g_savedRect.left, g_savedRect.top,
                     g_savedRect.right - g_savedRect.left, g_savedRect.bottom - g_savedRect.top,
                     SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
}

std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
    w.resize(n - 1);
    return w;
}

bool isOurs(const wchar_t* uri) {
    return uri && wcsncmp(uri, g_home.c_str(), g_home.size()) == 0;
}

void openOutside(const wchar_t* uri) {
    if (uri && wcsncmp(uri, L"https://", 8) == 0)
        ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
}

void setup(HWND parent) {
    g_parent = parent;
    ComPtr<ICoreWebView2Settings> settings;
    g_view->get_Settings(&settings);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_AreDefaultContextMenusEnabled(FALSE);
#ifdef NDEBUG
    settings->put_AreDevToolsEnabled(FALSE);
#endif

    // Match the interface background so there is no white flash on start.
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(g_controller.As(&controller2))) {
        COREWEBVIEW2_COLOR black = { 255, 0, 0, 0 };
        controller2->put_DefaultBackgroundColor(black);
    }

    // Links to the outside world open in the normal browser, not inside RICO.
    // RICO's own pages (output windows for a projector or second screen)
    // open as their own windows.
    g_view->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                if (!isOurs(uri)) {
                    openOutside(uri);
                    args->put_Handled(TRUE);
                }
                CoTaskMemFree(uri);
                return S_OK;
            }).Get(), nullptr);

    g_view->add_ContainsFullScreenElementChanged(
        Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
            [](ICoreWebView2* view, IUnknown*) -> HRESULT {
                BOOL full = FALSE;
                view->get_ContainsFullScreenElement(&full);
                setFullscreen(full != FALSE);
                return S_OK;
            }).Get(), nullptr);

    g_view->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                if (!isOurs(uri)) {
                    openOutside(uri);
                    args->put_Cancel(TRUE);
                }
                CoTaskMemFree(uri);
                return S_OK;
            }).Get(), nullptr);

    // Hidden until the page starts to draw, so RICO's own start screen shows
    // instead of an empty black window.
    g_controller->put_IsVisible(FALSE);
    auto show = []() {
        if (g_shown || !g_controller) return;
        g_shown = true;
        g_controller->put_IsVisible(TRUE);
        if (g_parent) InvalidateRect(g_parent, nullptr, TRUE);
    };
    g_view->add_ContentLoading(
        Callback<ICoreWebView2ContentLoadingEventHandler>(
            [show](ICoreWebView2*, ICoreWebView2ContentLoadingEventArgs*) -> HRESULT { show(); return S_OK; }).Get(), nullptr);
    g_view->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [show](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*) -> HRESULT { show(); return S_OK; }).Get(), nullptr);

    WebShell_Resize(parent);
    g_view->Navigate(g_home.c_str());
}

} // namespace

bool WebShell_Available() {
    LPWSTR version = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    bool ok = SUCCEEDED(hr) && version;
    if (version) CoTaskMemFree(version);
    return ok;
}

bool WebShell_Create(HWND parent, const std::string& url) {
    g_home = widen(url);
    // Keep the browser cache with the rest of RICO's data so the app stays portable.
    std::wstring dataDir = widen(Paths::DataDir() + "webview");

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, dataDir.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [parent](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(result) || !env) {
                    g_failed = true;
                    return result;
                }
                return env->CreateCoreWebView2Controller(parent,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [parent](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(result) || !controller) {
                                g_failed = true;
                                return result;
                            }
                            g_controller = controller;
                            g_controller->get_CoreWebView2(&g_view);
                            setup(parent);
                            return S_OK;
                        }).Get());
            }).Get());
    if (FAILED(hr)) g_failed = true;
    return SUCCEEDED(hr);
}

void WebShell_Resize(HWND parent) {
    if (!g_controller) return;
    RECT r;
    GetClientRect(parent, &r);
    g_controller->put_Bounds(r);
}

void WebShell_Destroy() {
    if (g_controller) g_controller->Close();
    g_view.Reset();
    g_controller.Reset();
}

bool WebShell_Failed() { return g_failed; }

bool WebShell_Shown() { return g_shown || g_failed; }

void WebShell_SetZoom(double z) {
    if (!g_controller) return;
    if (z < 0.5) z = 0.5;
    if (z > 2.0) z = 2.0;
    g_controller->put_ZoomFactor(z);
}

double WebShell_Zoom() {
    double z = 1.0;
    if (g_controller) g_controller->get_ZoomFactor(&z);
    return z;
}

#endif
