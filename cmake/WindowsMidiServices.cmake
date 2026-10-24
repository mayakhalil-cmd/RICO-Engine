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
set(RICO_WINMIDI_VERSION "1.0.15-rc.2.15" CACHE STRING "NuGet package version")
set(RICO_CPPWINRT_VERSION "2.0.250303.1" CACHE STRING "C++/WinRT NuGet version")

function(_rico_nuget id version out_dir)
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
    _rico_nuget(${RICO_WINMIDI_PACKAGE} ${RICO_WINMIDI_VERSION} midi_dir)
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
