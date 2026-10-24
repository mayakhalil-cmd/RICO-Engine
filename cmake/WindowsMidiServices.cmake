# Windows MIDI Services (virtual MIDI ports without third-party drivers).
#
# Downloads the MIT licensed Windows MIDI Services App SDK package and the
# C++/WinRT tool from NuGet, then generates the C++ headers for it. Nothing
# from here is copied next to RICO.exe: the runtime comes from Microsoft's
# own installer (https://aka.ms/midi) or from Windows itself.
#
# If this step gives you trouble, configure with -DRICO_WITH_WINDOWS_MIDI=OFF.
# RICO still builds and runs, it just can't make virtual ports.

set(RICO_WINMIDI_PACKAGE "Microsoft.Windows.Devices.Midi2" CACHE STRING "NuGet package id")
# Microsoft takes older preview versions off NuGet now and then, so a few are
# tried in order. Set RICO_WINMIDI_VERSION to use only the one you want.
set(RICO_WINMIDI_VERSION "" CACHE STRING "NuGet package version (empty: try the known ones)")
set(RICO_WINMIDI_VERSIONS "1.0.17-rc.4.25;1.0.16-rc.3.20;1.0.15-rc.2.15;1.0.14-rc.1.209" CACHE STRING "Versions to try, newest first")
set(RICO_CPPWINRT_VERSION "2.0.250303.1" CACHE STRING "C++/WinRT NuGet version")

# Gets a NuGet package. With SOFT, a failed download sets out_dir to "" instead
# of stopping the build.
function(_rico_nuget id version out_dir)
    cmake_parse_arguments(N "SOFT" "" "" ${ARGN})
    # 1. A copy you already have: packages/<id>.<version>/ next to this file's
    #    project (the same layout Visual Studio's NuGet uses).
    set(local ${CMAKE_SOURCE_DIR}/packages/${id}.${version})
    if(EXISTS ${local})
        set(${out_dir} ${local} PARENT_SCOPE)
        return()
    endif()

    # 2. Download it once into the build folder.
    string(TOLOWER ${id} lower)
    set(dir ${CMAKE_BINARY_DIR}/_deps/${lower}.${version})
    if(NOT EXISTS ${dir}/.done)
        set(pkg ${dir}.nupkg)
        message(STATUS "Downloading ${id} ${version}")
        file(DOWNLOAD "https://www.nuget.org/api/v2/package/${id}/${version}" ${pkg} STATUS result)
        list(GET result 0 code)
        if(NOT code EQUAL 0)
            file(REMOVE ${pkg})
            if(N_SOFT)
                message(STATUS "  ${id} ${version} is not on NuGet (${result})")
                set(${out_dir} "" PARENT_SCOPE)
                return()
            endif()
            message(FATAL_ERROR "Could not download ${id} ${version} (${result}).\n"
                                "Put the package in ${local}/ (for example from another project's "
                                "packages folder), or configure with -DRICO_WITH_WINDOWS_MIDI=OFF.")
        endif()
        file(ARCHIVE_EXTRACT INPUT ${pkg} DESTINATION ${dir})
        file(WRITE ${dir}/.done "")
    endif()
    set(${out_dir} ${dir} PARENT_SCOPE)
endfunction()

# cppwinrt.exe ships with the Windows SDK, so use that when it is there.
function(_rico_find_cppwinrt out)
    file(GLOB sdk_tools "C:/Program Files (x86)/Windows Kits/10/bin/*/x64/cppwinrt.exe")
    if(sdk_tools)
        list(SORT sdk_tools)
        list(REVERSE sdk_tools)
        list(GET sdk_tools 0 tool)
        set(${out} ${tool} PARENT_SCOPE)
        return()
    endif()
    _rico_nuget(Microsoft.Windows.CppWinRT ${RICO_CPPWINRT_VERSION} winrt_dir)
    set(${out} ${winrt_dir}/bin/cppwinrt.exe PARENT_SCOPE)
endfunction()

function(rico_add_windows_midi target)
    if(RICO_WINMIDI_VERSION)
        set(versions ${RICO_WINMIDI_VERSION})
    else()
        set(versions ${RICO_WINMIDI_VERSIONS})
    endif()
    set(midi_dir "")
    foreach(v IN LISTS versions)
        _rico_nuget(${RICO_WINMIDI_PACKAGE} ${v} midi_dir SOFT)
        if(midi_dir)
            message(STATUS "Windows MIDI Services SDK ${v}")
            break()
        endif()
    endforeach()
    if(NOT midi_dir)
        # RICO still builds and runs, only without virtual MIDI ports
        message(WARNING "Could not get the Windows MIDI Services SDK from NuGet (tried ${versions}). "
                        "RICO is built without virtual MIDI ports. Put the package in "
                        "${CMAKE_SOURCE_DIR}/packages/${RICO_WINMIDI_PACKAGE}.<version>/ to add them.")
        return()
    endif()
    _rico_find_cppwinrt(cppwinrt)
    message(STATUS "cppwinrt: ${cppwinrt}")

    file(GLOB winmd ${midi_dir}/ref/native/*.winmd)
    if(NOT winmd)
        message(FATAL_ERROR "No .winmd found in ${midi_dir}/ref/native")
    endif()

    set(gen ${CMAKE_BINARY_DIR}/_deps/winrt-headers)
    if(NOT EXISTS ${gen}/winrt/base.h)
        message(STATUS "Generating C++/WinRT headers (takes a minute the first time)")
        execute_process(
            COMMAND ${cppwinrt} -input sdk -input ${winmd} -output ${gen}
            RESULT_VARIABLE rc OUTPUT_QUIET)
        if(NOT rc EQUAL 0)
            message(FATAL_ERROR "cppwinrt failed (${rc}). Is the Windows 11 SDK installed in Visual Studio?")
        endif()
    endif()

    target_include_directories(${target} PRIVATE ${gen} ${midi_dir}/build/native/include)
    target_compile_definitions(${target} PRIVATE RICO_WITH_WINDOWS_MIDI)
    target_link_libraries(${target} PRIVATE windowsapp)
    if(MSVC)
        # C++/WinRT headers are large
        target_compile_options(${target} PRIVATE /bigobj)
    endif()
endfunction()
