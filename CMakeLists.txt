cmake_minimum_required(VERSION 3.24)

project(RICO VERSION 3.0.0 LANGUAGES C CXX)

option(RICO_WITH_WINDOWS_MIDI "Virtual MIDI ports with Windows MIDI Services" ON)
option(RICO_WITH_WEBVIEW      "The new interface (needs the WebView2 SDK from vcpkg)" ON)
option(RICO_BUILD_NDI_PLUGIN  "Build plugins/rico-ndi.dll" ON)
option(RICO_BUILD_UI          "Build the interface with npm while building RICO" ON)

if(NOT WIN32)
    message(FATAL_ERROR "RICO builds on Windows for now. A Mac version is planned.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")

# Everything RICO needs ends up in one folder, so it can be copied to a USB
# stick and run from there.
set(RICO_OUT ${CMAKE_BINARY_DIR}/RICO)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${RICO_OUT})
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG ${RICO_OUT})
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE ${RICO_OUT})
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO ${RICO_OUT})

find_package(nlohmann_json CONFIG REQUIRED)
find_package(PahoMqttCpp CONFIG REQUIRED)

# ---- third party code that lives in this repository ---------------------

add_library(rico_thirdparty STATIC
    third_party/imgui/imgui.cpp
    third_party/imgui/imgui_draw.cpp
    third_party/imgui/imgui_tables.cpp
    third_party/imgui/imgui_widgets.cpp
    third_party/imgui/imgui_demo.cpp
    third_party/imgui/backends/imgui_impl_dx11.cpp
    third_party/imgui/backends/imgui_impl_win32.cpp
    third_party/oscpack/ip/IpEndpointName.cpp
    third_party/oscpack/ip/win32/NetworkingUtils.cpp
    third_party/oscpack/ip/win32/UdpSocket.cpp
    third_party/oscpack/osc/OscOutboundPacketStream.cpp
    third_party/oscpack/osc/OscPrintReceivedElements.cpp
    third_party/oscpack/osc/OscReceivedElements.cpp
    third_party/oscpack/osc/OscTypes.cpp
    third_party/spout2/SpoutCopy.cpp
    third_party/spout2/SpoutDirectX.cpp
    third_party/spout2/SpoutDX.cpp
    third_party/spout2/SpoutFrameCount.cpp
    third_party/spout2/SpoutSenderNames.cpp
    third_party/spout2/SpoutSharedMemory.cpp
    third_party/spout2/SpoutUtils.cpp
    third_party/rtmidi/RtMidi.cpp
    third_party/pffft/pffft.c
    third_party/pffft/pffft_common.c
)
target_include_directories(rico_thirdparty PUBLIC
    third_party/imgui
    third_party/imgui/backends
    third_party/oscpack
    third_party/spout2
    third_party/rtmidi
    third_party/pffft
    third_party/miniaudio
    third_party/stb
    third_party/libomt
)
target_compile_definitions(rico_thirdparty PUBLIC
    __WINDOWS_MM__ PFFFT_STATIC NOMINMAX UNICODE _UNICODE _CRT_SECURE_NO_WARNINGS)
target_link_libraries(rico_thirdparty PUBLIC d3d11 dxgi d3dcompiler winmm ws2_32 winhttp shlwapi dwmapi version)
if(MSVC)
    target_compile_options(rico_thirdparty PRIVATE /W0 /utf-8)
endif()

# ---- RICO ----------------------------------------------------------------

file(GLOB_RECURSE RICO_SOURCES CONFIGURE_DEPENDS app/src/*.cpp app/src/*.h)

add_executable(RICO WIN32
    app/main.cpp
    ${RICO_SOURCES}
    app/resources/RICO.rc
    app/resources/RICO.manifest
)
target_include_directories(RICO PRIVATE app include)
target_compile_definitions(RICO PRIVATE RICO_VERSION="${PROJECT_VERSION}")
target_link_libraries(RICO PRIVATE
    rico_thirdparty
    nlohmann_json::nlohmann_json
    PahoMqttCpp::paho-mqttpp3
    ole32 shell32 user32 gdi32 iphlpapi
)
if(MSVC)
    target_compile_options(RICO PRIVATE /W3 /utf-8 /permissive- /Zc:__cplusplus /MP)
    # libomt.h asks the linker for libomt.lib, but RICO loads libomt.dll at
    # run time instead, so OMT stays optional.
    target_link_options(RICO PRIVATE /NODEFAULTLIB:libomt.lib)
endif()

if(RICO_WITH_WEBVIEW)
    find_package(unofficial-webview2 CONFIG REQUIRED)
    target_link_libraries(RICO PRIVATE unofficial::webview2::webview2)
    target_compile_definitions(RICO PRIVATE RICO_WITH_WEBVIEW)
endif()

if(RICO_WITH_WINDOWS_MIDI)
    include(cmake/WindowsMidiServices.cmake)
    rico_add_windows_midi(RICO)
endif()

# OMT runtime (libomt.dll + libvmx.dll), copied next to RICO.exe
include(cmake/OpenMediaTransport.cmake)
rico_add_omt_runtime(RICO)

# Fonts the classic interface uses
add_custom_command(TARGET RICO POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/assets ${RICO_OUT}/assets
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_SOURCE_DIR}/LICENSE ${RICO_OUT}/LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_SOURCE_DIR}/THIRD_PARTY_NOTICES.md ${RICO_OUT}/THIRD_PARTY_NOTICES.md
)

# ---- the interface -------------------------------------------------------

if(RICO_BUILD_UI)
    find_program(NPM npm)
    if(NPM)
        # npm is a .cmd script on Windows. Without "cmd /c", the first npm
        # call ends the whole build step and the second one never runs.
        add_custom_target(rico_ui ALL
            COMMAND cmd /c "${NPM}" install --no-audit --no-fund
            COMMAND cmd /c "${NPM}" run build -- --outDir "${RICO_OUT}/ui" --emptyOutDir
            WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/ui
            COMMENT "Building the RICO interface"
            USES_TERMINAL)
        add_dependencies(RICO rico_ui)
    else()
        message(WARNING "npm was not found, so the new interface is not built. "
                        "Install Node.js or RICO will start with the classic interface.")
    endif()
endif()

# ---- plugins -------------------------------------------------------------

if(RICO_BUILD_NDI_PLUGIN)
    add_subdirectory(plugins/ndi)
endif()
