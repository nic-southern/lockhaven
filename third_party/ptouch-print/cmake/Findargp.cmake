# This file is part of CMake-argp.
#
# CMake-argp is free software: you can redistribute it and/or modify it under
# the terms of the GNU Lesser General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option) any
# later version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
# FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License along
# with this program. If not, see
#
#  http://www.gnu.org/licenses/
#
#
# Copyright (c)
#   2016-2017 Alexander Haase <ahaase@alexhaase.de>
#

include(CheckFunctionExists)
include(FindPackageHandleStandardArgs)
include(FindPackageMessage)


# Do the following checks for header, library and argp functions quietly. Only
# print the result at the end of this file.
set(CMAKE_REQUIRED_QUIET TRUE)


# First check if argp is shipped together with libc without linking to any other
# library or including any paths. In that case, no files for argp need to be
# searched and argp may be used out-of-the-box.
check_function_exists("argp_parse" ARGP_IN_LIBC)
if (ARGP_IN_LIBC)
	# Set the argp library- and include-paths to empty values, otherwise CMake
	# might print warnings about unknown variables and fills them with
	# 'xy-NOTFOUND'.
	set(ARGP_FOUND TRUE)
	set(ARGP_LIBRARIES "")
	set(ARGP_INCLUDE_PATH "")

	# Print a message, that argp has been successfully found and return from
	# this module, as argp doesn't need to be searched as a separate library.
	find_package_message(argp "Found argp: built-in" "built-in")
	return()
endif()


# Argp is not part of the libc, so it needs to be searched as a separate library
# with its own include directory.
#
# First search the argp header file. If it is not found, any further steps will
# fail.
find_path(ARGP_INCLUDE_PATH "argp.h")
if (ARGP_INCLUDE_PATH)
    # Try to find the argp library and check if it has the required argp_parse
    # function.
	set(CMAKE_REQUIRED_INCLUDES "${ARGP_INCLUDE_PATH}")
    find_library(ARGP_LIBRARIES "argp")

    # Check if argp_parse is available. Some implementations don't have this
    # symbol defined, thus they're not compatible.
    #
    # argp-standalone itself calls strchrnul(), a GNU extension that the
    # platforms needing argp-standalone tend to lack (macOS among them). On
    # those the plain link test fails with an undefined strchrnul and would
    # report a perfectly good libargp as lacking argp_parse. So probe for
    # strchrnul first and, where it is missing, run the argp_parse test with
    # a local definition; the project then supplies the same definition.
    if (ARGP_LIBRARIES)
        set(CMAKE_REQUIRED_LIBRARIES "${ARGP_LIBRARIES}")
        include(CheckSymbolExists)
        set(CMAKE_REQUIRED_DEFINITIONS -D_GNU_SOURCE)
        check_symbol_exists("strchrnul" "string.h" HAVE_STRCHRNUL)
        unset(CMAKE_REQUIRED_DEFINITIONS)
        if (HAVE_STRCHRNUL)
            check_function_exists("argp_parse" ARGP_EXTERNAL)
        else ()
            include(CheckCSourceCompiles)
            check_c_source_compiles("
                #include <string.h>
                #include <argp.h>
                char *strchrnul(const char *s, int c) {
                    const char *p = strchr(s, c);
                    return (char *)(p ? p : s + strlen(s));
                }
                int main(void) { return argp_parse(0, 1, (char *[]){\"x\"}, 0, 0, 0); }
            " ARGP_EXTERNAL)
        endif ()
        if (NOT ARGP_EXTERNAL)
            message(FATAL_ERROR "Your system ships an argp library in "
                    "${ARGP_LIBRARIES}, but it does not have a symbol "
                    "named argp_parse.")
        endif ()
    endif ()
endif ()


# Restore the quiet settings. By default the last check should be printed if not
# disabled in the find_package call.
set(CMAKE_REQUIRED_QUIET ${argp_FIND_QUIETLY})


# Check for all required variables.
find_package_handle_standard_args(argp
	DEFAULT_MSG
	ARGP_LIBRARIES ARGP_INCLUDE_PATH)
mark_as_advanced(ARGP_LIBRARIES ARGP_INCLUDE_PATH)
