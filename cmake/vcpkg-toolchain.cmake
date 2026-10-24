# Picks which vcpkg to use, then hands over to it.
#
# Visual Studio sets VCPKG_ROOT to the copy it ships with, which is often too
# old for RICO's packages. So this looks in this order:
#   1. RICO_VCPKG_ROOT, if you set it
#   2. VCPKG_ROOT, unless it points inside Visual Studio
#   3. C:/vcpkg
#   4. Visual Studio's own copy, as a last resort

set(_rico_vcpkg "")
if(DEFINED ENV{RICO_VCPKG_ROOT} AND EXISTS "$ENV{RICO_VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake")
    set(_rico_vcpkg "$ENV{RICO_VCPKG_ROOT}")
elseif(DEFINED ENV{VCPKG_ROOT} AND NOT "$ENV{VCPKG_ROOT}" MATCHES "Microsoft Visual Studio"
       AND EXISTS "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake")
    set(_rico_vcpkg "$ENV{VCPKG_ROOT}")
elseif(EXISTS "C:/vcpkg/scripts/buildsystems/vcpkg.cmake")
    set(_rico_vcpkg "C:/vcpkg")
elseif(DEFINED ENV{VCPKG_ROOT} AND EXISTS "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake")
    set(_rico_vcpkg "$ENV{VCPKG_ROOT}")
    message(WARNING "Using the vcpkg inside Visual Studio. If packages fail to build, "
                    "clone vcpkg to C:/vcpkg (see docs/BUILDING.md).")
endif()

if(NOT _rico_vcpkg)
    message(FATAL_ERROR "vcpkg was not found. Clone it to C:/vcpkg (see docs/BUILDING.md).")
endif()
file(TO_CMAKE_PATH "${_rico_vcpkg}" _rico_vcpkg)

# vcpkg builds packages with the newest MSVC it can find, while Visual Studio
# builds RICO with its default MSVC. When those differ, linking fails with
# errors like "_Cnd_timedwait_for_unchecked". So tell vcpkg (through RICO's
# own triplet in cmake/triplets) to use Visual Studio's default version.
set(_vswhere "$ENV{ProgramFiles\(x86\)}/Microsoft Visual Studio/Installer/vswhere.exe")
if(NOT DEFINED ENV{RICO_MSVC_VERSION} AND EXISTS "${_vswhere}")
    execute_process(COMMAND "${_vswhere}" -latest -products * -property installationPath
                    OUTPUT_VARIABLE _vs OUTPUT_STRIP_TRAILING_WHITESPACE)
    set(_full "")
    # MSBuild reads the v143 props file first, so check it first too.
    set(_props "${_vs}/VC/Auxiliary/Build/Microsoft.VCToolsVersion.v143.default.props")
    set(_txt "${_vs}/VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt")
    if(DEFINED ENV{VCToolsVersion})
        set(_full "$ENV{VCToolsVersion}")
    elseif(EXISTS "${_props}")
        file(READ "${_props}" _xml)
        string(REGEX MATCH "<VCToolsVersion[^>]*>([0-9.]+)<" _m "${_xml}")
        set(_full "${CMAKE_MATCH_1}")
    endif()
    if(NOT _full AND EXISTS "${_txt}")
        file(READ "${_txt}" _full)
    endif()
    string(STRIP "${_full}" _full)
    string(REGEX MATCH "^[0-9]+\\.[0-9]+" _short "${_full}")
    if(_short)
        set(ENV{RICO_MSVC_VERSION} "${_short}")
        message(STATUS "MSVC for packages: ${_full}")
    endif()
endif()
if(DEFINED ENV{RICO_MSVC_VERSION})
    if(DEFINED ENV{VCPKG_KEEP_ENV_VARS})
        set(ENV{VCPKG_KEEP_ENV_VARS} "$ENV{VCPKG_KEEP_ENV_VARS};RICO_MSVC_VERSION")
    else()
        set(ENV{VCPKG_KEEP_ENV_VARS} "RICO_MSVC_VERSION")
    endif()
endif()

set(VCPKG_OVERLAY_TRIPLETS "${CMAKE_CURRENT_LIST_DIR}/triplets" CACHE STRING "")

message(STATUS "vcpkg: ${_rico_vcpkg}")
include("${_rico_vcpkg}/scripts/buildsystems/vcpkg.cmake")
