/*
	libptouch - functions to help accessing a brother ptouch

	Copyright (C) 2013-2026 Dominic Radermacher <dominic@familie-radermacher.ch>

	This program is free software; you can redistribute it and/or modify it
	under the terms of the GNU General Public License version 3 as
	published by the Free Software Foundation

	This program is distributed in the hope that it will be useful, but
	WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
	See the GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program; if not, write to the Free Software Foundation,
	Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307 USA
*/

#define _POSIX_C_SOURCE	199309L	/* needed for nanosleep() when using -std=c11 */

#include <stdio.h>
#include <stdlib.h>	/* malloc() */
#include <string.h>	/* memcmp() */
#include <sys/types.h>	/* open() */
#include <sys/stat.h>	/* open() */
#include <fcntl.h>	/* open() */
#include <time.h>	/* nanosleep(), struct timespec */
#include <libintl.h>	/* gettext() */

#include "ptouch.h"

#define _(s) gettext(s)

/* Print area width in 180 DPI pixels */
/* The 360dpi print-area values (px360) are Brother's documented values for
   the PT-P900 series and are NOT simply double the 180dpi ones: the 180dpi
   figures for wide tapes are clamped by those printers' 128-pin printheads,
   not the actual printable width. Only 36mm has been verified on hardware;
   the others come from Brother's raster reference. 21mm has no P900 spec
   value and keeps the doubled figure. calc_tape_px() clamps the result to
   the printer's max_px, so printers with a narrower printhead stay safe. */
struct _pt_tape_info tape_info[]= {
	{ 4,  24,  48, 0.5},	/* 3.5 mm tape */
	{ 6,  32,  64, 1.0},	/*  6 mm tape */
	{ 9,  52, 106, 1.0},	/*  9 mm tape */
	{12,  76, 150, 2.0},	/* 12 mm tape */
	{18, 120, 234, 3.0},	/* 18 mm tape */
	{21, 124, 248, 3.0},	/* 21 mm tape (360dpi value unverified) */
	{24, 128, 320, 3.0},	/* 24 mm tape */
	{36, 192, 454, 4.5},	/* 36 mm tape */
	{ 0,   0,   0, 0.0}	/* terminating entry */
};

struct _pt_dev_info ptdevs[] = {
	{0x04f9, 0x2001, "PT-9200DX", 384, 360, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT, 0, 0},	/* 360dpi, maximum 128px, max tape width 36mm */
	{0x04f9, 0x2002, "PT-9200DX", 384, 360, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT, 0, 0},	/* reported by Christian Pauls - either 0x2001 is wrong, or this printer exists with two different IDs  */
	{0x04f9, 0x203c, "PT-9700PC", 384, 360, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT|FLAG_P700_INIT|FLAG_USE_INFO_CMD, 0, 0},	/* 360dpi, max tape width 36mm. FLAG_P700_INIT causes printer to send a status response after rasterstart; flushed in ptouch_rasterstart(). */
	{0x04f9, 0x2004, "PT-2300", 112, 180, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT, 0, 0},	/* 180dpi, 112px printhead */
	{0x04f9, 0x2007, "PT-2420PC", 128, 180, FLAG_RASTER_PACKBITS, 0, 0},	/* 180dpi, 128px, maximum tape width 24mm, must send TIFF compressed pixel data */
	//{0x04f9, 0x200d, "PT-3600", 384, 360, FLAG_RASTER_PACKBITS, 0, 0},
	{0x04f9, 0x2011, "PT-2450PC", 128, 180, FLAG_RASTER_PACKBITS, 0, 0},
	{0x04f9, 0x2019, "PT-1950", 112, 180, FLAG_RASTER_PACKBITS, 0, 0},	/* 180dpi, apparently 112px printhead ?, maximum tape width 18mm - unconfirmed if it works */
	{0x04f9, 0x201f, "PT-2700", 128, 180, FLAG_HAS_PRECUT, 0, 0},
	{0x04f9, 0x202c, "PT-1230PC", 128, 180, FLAG_NONE, 0, 0},		/* 180dpi, supports tapes up to 12mm - I don't know how much pixels it can print! */
	/* Notes about the PT-1230PC: While it is true that this printer supports
	   max 12mm tapes, it apparently expects > 76px data - the first 32px
	   must be blank. */
	{0x04f9, 0x202d, "PT-2430PC", 128, 180, FLAG_HAS_PRECUT, 0, 0},	/* 180dpi, maximum 128px. Same head width/dpi as PT-2700 (which has FLAG_HAS_PRECUT); confirmed precut works on real hardware. */
	{0x04f9, 0x2030, "PT-1230PC (PLite Mode)", 128, 180, FLAG_PLITE, 0, 0},
	{0x04f9, 0x2031, "PT-2430PC (PLite Mode)", 128, 180, FLAG_PLITE, 0, 0},
	{0x04f9, 0x2041, "PT-2730", 128, 180, FLAG_NONE, 0, 0},		/* 180dpi, maximum 128px, max tape width 24mm - reported to work with some quirks */
	/* Notes about the PT-2730: was reported to need 48px whitespace
	   within png-images before content is actually printed - can not check this */
	{0x04f9, 0x205e, "PT-H500", 128, 180, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT, 0, 0},
	/* Note about the PT-H500: was reported by Eike with the remark that
	   it might need some trailing padding */
	{0x04f9, 0x205f, "PT-E500", 128, 180, FLAG_RASTER_PACKBITS, 0, 0},
	/* Note about the PT-E500: was reported by Jesse Becker with the
	   remark that it also needs some padding (white pixels) */
	{0x04f9, 0x2060, "PT-E550W", 128, 180, FLAG_UNSUP_RASTER, 0, 0},
	/* Note about the PT-E550W: was reported by Tim Biermann but does not
	   work yet (only prints empty tape with FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT) */
	{0x04f9, 0x2061, "PT-P700", 128, 180, FLAG_RASTER_PACKBITS|FLAG_P700_INIT|FLAG_HAS_PRECUT, 0, 0},
	{0x04f9, 0x2062, "PT-P750W", 128, 180, FLAG_RASTER_PACKBITS|FLAG_P700_INIT, 0, 0},
	{0x04f9, 0x2064, "PT-P700 (PLite Mode)", 128, 180, FLAG_PLITE, 0, 0},
	{0x04f9, 0x2065, "PT-P750W (PLite Mode)", 128, 180, FLAG_PLITE, 0, 0},
	{0x04f9, 0x2073, "PT-D450", 128, 180, FLAG_USE_INFO_CMD, 0, 0},
	/* Notes about the PT-D450: I'm unsure if print width really is 128px */
	{0x04f9, 0x2074, "PT-D600", 128, 180, FLAG_RASTER_PACKBITS, 0, 0},
	/* PT-D600 was reported to work, but with some quirks (premature
	   cutting of tape, printing maximum of 73mm length) */
	{0x04f9, 0x2085, "PT-P900Wc", 560, 360, FLAG_RASTER_PACKBITS|FLAG_P700_INIT|FLAG_USE_INFO_CMD|FLAG_HAS_PRECUT, -8, 0},
	/* PT-P900Wc: 360dpi, 560px printhead (70 bytes/raster line). Verified
	   printing on 36mm laminated tape. Narrower tape widths use Brother's
	   documented 360dpi print areas (see tape_info) but are untested.
	   pin_offset = -8: the print area is centred at pin 272, not the head
	   centre (pin 280) - a constant offset across all tape widths. See the
	   Brother "Software Developer's Manual - Raster Command Reference,
	   PT-P900/P900W/P950NW", section 2.3.5 "Raster line". */
	{0x04f9, 0x20af, "PT-P710BT", 128, 180, FLAG_RASTER_PACKBITS|FLAG_HAS_PRECUT, 0, 0},
	{0x04f9, 0x20df, "PT-D410", 128, 180, FLAG_USE_INFO_CMD|FLAG_HAS_PRECUT|FLAG_D460BT_MAGIC, 0, 0},
	{0x04f9, 0x20e0, "PT-D460BT", 128, 180, FLAG_P700_INIT|FLAG_USE_INFO_CMD|FLAG_HAS_PRECUT|FLAG_D460BT_MAGIC, 0, 0},
	{0x04f9, 0x20e1, "PT-D610BT", 128, 180, FLAG_P700_INIT|FLAG_USE_INFO_CMD|FLAG_HAS_PRECUT|FLAG_D460BT_MAGIC, 0, 0},
	/* added by Christian, PT-E310BT (aka PT-E310BTVP) requires these flags, otherwise not returning from libusb_bulk_transfer-call */
	/* printhead 128px, 180 dpi resolution */
	/* 3,5/6/9/12/18 mm TZe Tapes, 12mm and 18mm tested */
	/* 5,2/9/11,2 mm HSe heat shrink tubes not tested, probably requiring extension of struct _pt_tape_info */
	{0x04f9, 0x2201, "PT-E310BT", 128, 180, FLAG_P700_INIT|FLAG_USE_INFO_CMD|FLAG_D460BT_MAGIC, 0, 0},
	{0x04f9, 0x2203, "PT-E560BT", 128, 180, FLAG_P700_INIT|FLAG_USE_INFO_CMD|FLAG_D460BT_MAGIC, 0, 10},
	{0,0,"",0,0,0,0,0}
};

int ptouch_open(ptouch_dev *ptdev)
{
	return ptouch_open_serial(ptdev, NULL);
}

/* Like ptouch_open(), but when serial is not NULL only a printer whose
   USB serial number matches it is used. */
int ptouch_open_serial(ptouch_dev *ptdev, const char *serial)
{
	libusb_device **devs;
	libusb_device *dev;
	libusb_device_handle *handle = NULL;
	struct libusb_device_descriptor desc;
	ssize_t cnt;
	int r,i=0;

	if ((*ptdev=malloc(sizeof(struct _ptouch_dev))) == NULL) {
		fprintf(stderr, _("out of memory\n"));
		return -1;
	}
	if (((*ptdev)->devinfo=malloc(sizeof(struct _pt_dev_info))) == NULL) {
		fprintf(stderr, _("out of memory\n"));
		return -1;
	}
	if (((*ptdev)->status=malloc(sizeof(struct _ptouch_stat))) == NULL) {
		fprintf(stderr, _("out of memory\n"));
		return -1;
	}
	if ((libusb_init(NULL)) < 0) {
		fprintf(stderr, _("libusb_init() failed\n"));
		return -1;
	}
//	libusb_set_debug(NULL, 3);
	if ((cnt=libusb_get_device_list(NULL, &devs)) < 0) {
		return -1;
	}
	while ((dev=devs[i++]) != NULL) {
		if ((r=libusb_get_device_descriptor(dev, &desc)) < 0) {
			fprintf(stderr, _("failed to get device descriptor"));
			libusb_free_device_list(devs, 1);
			return -1;
		}
		for (int k=0; ptdevs[k].vid > 0; ++k) {
			if ((desc.idVendor == ptdevs[k].vid) && (desc.idProduct == ptdevs[k].pid) && (ptdevs[k].flags >= 0)) {
				unsigned char buf[64] = {0};
				if ((r=libusb_open(dev, &handle)) != 0) {
					fprintf(stderr, _("libusb_open error :%s\n"), libusb_error_name(r));
					if (serial) {
						/* can't read its serial, so it can't be the one we want */
						break;
					}
					libusb_free_device_list(devs, 1);
					return -1;
				}
				if (desc.iSerialNumber) {
					libusb_get_string_descriptor_ascii(handle, desc.iSerialNumber, buf, sizeof(buf));
				}
				fprintf(stderr, _("%s found on USB bus %d, device %d, serial %s\n"),
					ptdevs[k].name,
					libusb_get_bus_number(dev),
					libusb_get_device_address(dev),
					buf[0] ? (char *)buf : "-");
				/* check the serial before the P-Lite/unsupported checks, so
				   a different printer in the wrong mode doesn't end the search */
				if (serial && (strcmp((char *)buf, serial) != 0)) {
					libusb_close(handle);
					handle = NULL;
					break;	/* next device */
				}
				if (ptdevs[k].flags & FLAG_PLITE) {
					printf("Printer is in P-Lite Mode, which is unsupported\n\n");
					printf("Turn off P-Lite mode by changing switch from position EL to position E\n");
					printf("or by pressing the PLite button for ~ 2 seconds (or consult the manual)\n");
					libusb_close(handle);
					libusb_free_device_list(devs, 1);
					return -1;
				}
				if (ptdevs[k].flags & FLAG_UNSUP_RASTER) {
					printf("Unfortunately, that printer currently is unsupported (it has a different raster data transfer)\n");
					libusb_close(handle);
					libusb_free_device_list(devs, 1);
					return -1;
				}
				libusb_free_device_list(devs, 1);
				if ((r=libusb_kernel_driver_active(handle, 0)) == 1) {
					if ((r=libusb_detach_kernel_driver(handle, 0)) != 0) {
						fprintf(stderr, _("error while detaching kernel driver: %s\n"), libusb_error_name(r));
					}
				}
				if ((r=libusb_claim_interface(handle, 0)) != 0) {
					fprintf(stderr, _("interface claim error: %s\n"), libusb_error_name(r));
					return -1;
				}
				(*ptdev)->h=handle;
				(*ptdev)->devinfo->dpi=ptdevs[k].dpi;
				(*ptdev)->devinfo->max_px=ptdevs[k].max_px;
				(*ptdev)->devinfo->flags=ptdevs[k].flags;
				(*ptdev)->devinfo->pin_offset=ptdevs[k].pin_offset;
				(*ptdev)->devinfo->min_timeout=ptdevs[k].min_timeout;
				return 0;
			}
		}
	}
	if (serial) {
		fprintf(stderr, _("No P-Touch printer with serial %s found\n"), serial);
	} else {
		fprintf(stderr, _("No P-Touch printer found on USB (remember to put switch to position E)\n"));
	}
	libusb_free_device_list(devs, 1);
	return -1;
}

int ptouch_close(ptouch_dev ptdev)
{
	if (!ptdev) {
		return -1;
	}
	libusb_release_interface(ptdev->h, 0);
	libusb_close(ptdev->h);
	return 0;
}

int ptouch_send(ptouch_dev ptdev, uint8_t *data, size_t len)
{
	int r, tx;

	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_send() with NULL ptdev\n"));
		return -1;
	}
	if (len > 128) {
		return -1;
	}
	if ((r=libusb_bulk_transfer(ptdev->h, 0x02, data, (int)len, &tx, 0)) != 0) {
		fprintf(stderr, _("write error: %s\n"), libusb_error_name(r));
		return -1;
	}
	if (tx != (int)len) {
		fprintf(stderr, _("write error: could send only %i of %ld bytes\n"), tx, len);
		return -1;
	}
	return 0;
}

int ptouch_init(ptouch_dev ptdev)
{
	/* first invalidate, then send init command */
	uint8_t cmd[102];
	memset(cmd, 0, 100);
	cmd[100] = 0x1b;	/* ESC */
	cmd[101] = 0x40;	/* @ */
	return ptouch_send(ptdev, (uint8_t *)cmd, sizeof(cmd));
}

/* Sends some magic commands to enable chaining on the PT-D460BT.
   These should go out right before magic commands. */
int ptouch_send_d460bt_chain(ptouch_dev ptdev)
{
	uint8_t cmd[] = "\x1b\x69\x4b\x00";
	return ptouch_send(ptdev, (uint8_t *)cmd, sizeof(cmd));
}

/* Sends some magic commands to make prints work on the PT-D460BT.
   These should go out after info_cmd and right before the raster data. */
int ptouch_send_d460bt_magic(ptouch_dev ptdev)
{
	/* 1B 69 64 {n1} {n2} {n3} {n4} */
	uint8_t cmd[7];
	/* n1 and n2 are the length margin/spacing, in px? (uint16_t value, little endian) */
	/* A value of 0x06 is equivalent to the width margin on 6mm tape */
	/* A value of 0x01 adds barely any margin, suitable for image printing */
	/* The default for P-Touch software is 0x0e */
	/* n3 must be 0x4D or the print gets corrupted! */
	/* n4 seems to be ignored or reserved. */
	memcpy(cmd, "\x1b\x69\x64\x01\x00\x4d\x00", 7);
	return ptouch_send(ptdev, (uint8_t *)cmd, sizeof(cmd));
}

int ptouch_enable_packbits(ptouch_dev ptdev)
{				/* 4D 00 = disable compression */
	char cmd[] = "M\x02";	/* 4D 02 = enable packbits compression mode */
	return ptouch_send(ptdev, (uint8_t *)cmd, strlen(cmd));
}

/* print information command */
int ptouch_info_cmd(ptouch_dev ptdev, int size_x)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_info_cmd() with NULL ptdev\n"));
		return -1;
	}

	/* 1B 69 7A {n1} {n2} {n3} {n4} {n5} {n6} {n7} {n8} {n9} {n10} */
	uint8_t cmd[] = "\x1b\x69\x7a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

	/* {n3}: Media width (mm)
	   {n4}: Media length (mm)
	   For the media of width 24 mm, specify as n3 = 18h and n4 = 00h.
	   n4 is normally 00h, regardless of the paper length. */
	cmd[5] = ptdev->status->media_width;

	/* {n5} -{n8}: Raster number
	   n8*256*256*256 + n7*256*256 + n6*256 + n5 */
	cmd[7] = (uint8_t) size_x & 0xff;
	cmd[8] = (uint8_t) (size_x >> 8) & 0xff;
	cmd[9] = (uint8_t) (size_x >> 16) & 0xff;
	cmd[10] = (uint8_t) (size_x >> 24) & 0xff;
	if ((ptdev->devinfo->flags & FLAG_D460BT_MAGIC) == FLAG_D460BT_MAGIC) {
		/* n9 is set to 2 in order to feed the last of the label and properly stop printing. */
		cmd[11] = (uint8_t) 0x02;
	}
	return ptouch_send(ptdev, cmd, sizeof(cmd)-1);
}

/* If set, printer will prompt to cut blank tape before finishing the print.
 If not set, printer will print normally with a big blank space on the label.
 The printer ignores this value if the print is very short. */
/* 0x80 horizontally mirrors the print */
int ptouch_send_precut_cmd(ptouch_dev ptdev, int precut)
{
	char cmd[] = "\x1b\x69\x4d\x00";
	if (precut) {
		cmd[3] = 0x40;
	}
	return ptouch_send(ptdev, (uint8_t *)cmd, sizeof(cmd)-1);
}

int ptouch_rasterstart(ptouch_dev ptdev)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_rasterstart() with NULL ptdev\n"));
		return -1;
	}
	/* 1B 69 52 01 = Select graphics transfer mode = Raster */
	char cmd[] = "\x1b\x69\x52\x01";
	/* 1B 69 61 01 = switch mode (0=esc/p, 1=raster mode) */
	char cmd2[] = "\x1b\x69\x61\x01";
	if (ptdev->devinfo->flags & FLAG_P700_INIT) {
		int r = ptouch_send(ptdev, (uint8_t *)cmd2, strlen(cmd2));
		if (r != 0) {
			return r;
		}
		/* Printer sends a status response after entering raster mode;
		   flush it so subsequent raster writes don't block. */
		uint8_t buf[32];
		int tx = 0;
		libusb_bulk_transfer(ptdev->h, 0x81, buf, sizeof(buf), &tx, 1000);
		return 0;
	} /* else */
	return ptouch_send(ptdev, (uint8_t *)cmd, strlen(cmd));
}

/* print an empty line */
int ptouch_lf(ptouch_dev ptdev)
{
	char cmd[]="\x5a";
	return ptouch_send(ptdev, (uint8_t *)cmd, strlen(cmd));
}

/* print and advance tape, but do not cut */
int ptouch_ff(ptouch_dev ptdev)
{
	char cmd[]="\x0c";
	return ptouch_send(ptdev, (uint8_t *)cmd, strlen(cmd));
}

/* finish print and either cut or leave tape in machine */
int ptouch_finalize(ptouch_dev ptdev, int chain)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_finalize() with NULL ptdev\n"));
		return -1;
	}

	char cmd_eject[]="\x1a"; /* Print command with feeding */
	char cmd_chain[]="\x0c"; /* Print command (no cut) */

	// The D460BT devices use a leading packet to indicate chaining instead.
	char *cmd = (chain && (!(ptdev->devinfo->flags & FLAG_D460BT_MAGIC))) ? cmd_chain : cmd_eject;
	return ptouch_send(ptdev, (uint8_t *)cmd, 1);
}


void ptouch_rawstatus(uint8_t raw[32])
{
	fprintf(stderr, _("debug: dumping raw status bytes\n"));
	for (int i=0; i<32; ++i) {
		fprintf(stderr, "0x%02x ", raw[i]);
		if (((i+1) % 16) == 0) {
			fprintf(stderr, "\n");
		}
	}
	fprintf(stderr, "\n");
	return;
}

int ptouch_getstatus(ptouch_dev ptdev, int timeout)
{
	char cmd[]="\x1biS";	/* 1B 69 53 = ESC i S = Status info request */
	uint8_t buf[32] = {};
	int r, tx=0, tries=0, maxtries=timeout*10;
	struct timespec w;

	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_getstatus() with NULL ptdev\n"));
		return -1;
	}

	ptouch_send(ptdev, (uint8_t *)cmd, strlen(cmd));
	while (tx == 0) {
		w.tv_sec=0;
		w.tv_nsec=100000000;	/* 0.1 sec */
		r=nanosleep(&w, NULL);
		if ((r=libusb_bulk_transfer(ptdev->h, 0x81, buf, 32, &tx, 0)) != 0) {
			fprintf(stderr, _("read error: %s\n"), libusb_error_name(r));
			return -1;
		}
		++tries;
		if (timeout && tries > maxtries) {
			fprintf(stderr, _("timeout (%i sec) while waiting for status response\n"), timeout);
			return -1;
		}
	}
	if (tx == 32) {
		if (buf[0]==0x80 && buf[1]==0x20) {
			memcpy(ptdev->status, buf, 32);
			ptdev->tape_width_px = ptouch_calc_tape_px(ptdev, buf[10]);
			if (ptdev->tape_width_px == 0) {
				fprintf(stderr, _("unknown tape width of %imm, please report this.\n"), buf[10]);
			}
			return 0;
		}
	}
	if (tx == 16) {
		fprintf(stderr, _("got only 16 bytes... wondering what they are:\n"));
		ptouch_rawstatus(buf);
	}
	if (tx != 32) {
		fprintf(stderr, _("read error: got %i instead of 32 bytes\n"), tx);
		return -1;
	}
	fprintf(stderr, _("strange status:\n"));
	ptouch_rawstatus(buf);
	fprintf(stderr, _("trying to flush junk\n"));
	if ((r=libusb_bulk_transfer(ptdev->h, 0x81, buf, 32, &tx, 0)) != 0) {
		fprintf(stderr, _("read error: %s\n"), libusb_error_name(r));
		return -1;
	}
	fprintf(stderr, _("got another %i bytes. now try again\n"), tx);
	return -1;
}

int ptouch_get_dpi(ptouch_dev ptdev)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_get_dpi() with NULL ptdev\n"));
		return 0;
	}
	return ptdev->devinfo->dpi;
}

int ptouch_calc_tape_px(ptouch_dev ptdev, const uint8_t tape_width_mm)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_cal_tape_width() with NULL ptdev\n"));
		return 0;
	}
	int tape_width_px = 0;
	for (int i=0; tape_info[i].mm > 0; ++i) {
		if (tape_info[i].mm == tape_width_mm) {
			if (ptdev->devinfo->dpi == 180) {
				tape_width_px = tape_info[i].px;
			} else if (ptdev->devinfo->dpi == 360) {
				tape_width_px = tape_info[i].px360;
			} else {
				fprintf(stderr, _("printer with %d dpi not supported\n"), ptdev->devinfo->dpi);
			}
		}
	}
	/* Never print wider than the physical printhead. This also keeps 360dpi
	   printers with a narrower head (e.g. PT-9200DX, 384px) safe when the
	   tape's printable area exceeds what they can drive. */
	if (tape_width_px > ptdev->devinfo->max_px) {
		tape_width_px = ptdev->devinfo->max_px;
	}
	return tape_width_px;
}

/* TODO: The actual number of maximum lines should be calculated according to
   printer resolution, tapewidth and fontsize */
/* printer resolution is planned to be taken into account when calculating
   tape_width in px */
int ptouch_get_max_lines(ptouch_dev ptdev, int fontsize_px)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_get_max_lines() with NULL ptdev\n"));
		return 0;
	}
	if (fontsize_px <= 0) {
		fprintf(stderr, _("debug: called ptouch_get_max_lines() with invalid fontsize_px\n"));
		return 0;
	}
	fprintf(stderr, _("debug: calculated max lines %d \n"), ptdev->tape_width_px / fontsize_px);
	return 4;
}

size_t ptouch_get_tape_width(ptouch_dev ptdev)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_get_tape_width() with NULL ptdev\n"));
		return 0;
	}
	return ptdev->tape_width_px;
}

size_t ptouch_get_max_width(ptouch_dev ptdev)
{
	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_get_max_width() with NULL ptdev\n"));
		return 0;
	}
	return ptdev->devinfo->max_px;
}

int ptouch_sendraster(ptouch_dev ptdev, uint8_t *data, size_t len)
{
	/* Must hold a full raster line (max_px/8 bytes) plus up to 4 header
	   bytes. ptouch_send() caps a packet at 128 bytes, so this is the
	   largest a packet can ever be. */
	uint8_t buf[128];
	int rc;

	if (!ptdev) {
		fprintf(stderr, _("debug: called ptouch_sendraster() with NULL ptdev\n"));
		return -1;
	}
	if (len > (size_t)(ptdev->devinfo->max_px / 8)) {
		return -1;
	}
	buf[0]=0x47;
	if (ptdev->devinfo->flags & FLAG_RASTER_PACKBITS) {
		/* Fake compression by encoding a single uncompressed run */
		buf[1] = (uint8_t)(len + 1);
		buf[2] = 0;
		buf[3] = (uint8_t)(len - 1);
		memcpy(buf + 4, data, len);
		rc = ptouch_send(ptdev, buf, len + 4);
	} else {
		buf[1] = (uint8_t)len;
		buf[2] = 0;
		memcpy(buf + 3, data, len);
		rc = ptouch_send(ptdev, buf, len + 3);
	}
	return rc;
}

void ptouch_list_supported()
{
	const int columns = 5;
	printf("Supported printers (some might have quirks)\n");
	int col=0;
	for (int i=0; ptdevs[i].vid > 0; ++i) {
		if ((ptdevs[i].flags & FLAG_PLITE) != FLAG_PLITE) {
			printf("%s", ptdevs[i].name);
			if (strlen(ptdevs[i].name) < 8) {
				printf("\t");
			}
			printf("%c", (col < (columns - 1))?'\t':'\n');
			++col;
			col = (col % columns);
		}
	}
	printf("\n");
	return;
}

/* Print every connected P-Touch printer with its USB serial number, which
   can then be passed to ptouch_open_serial(). Returns the number of
   printers found, or -1 on error. */
int ptouch_list_connected()
{
	libusb_device **devs;
	libusb_device *dev;
	libusb_device_handle *handle;
	struct libusb_device_descriptor desc;
	int r, i=0, found=0;

	if ((libusb_init(NULL)) < 0) {
		fprintf(stderr, _("libusb_init() failed\n"));
		return -1;
	}
	if (libusb_get_device_list(NULL, &devs) < 0) {
		libusb_exit(NULL);
		return -1;
	}
	while ((dev=devs[i++]) != NULL) {
		if (libusb_get_device_descriptor(dev, &desc) < 0) {
			continue;
		}
		for (int k=0; ptdevs[k].vid > 0; ++k) {
			if ((desc.idVendor == ptdevs[k].vid) && (desc.idProduct == ptdevs[k].pid) && (ptdevs[k].flags >= 0)) {
				unsigned char buf[64] = {0};
				const char *serial = "-";
				if ((r=libusb_open(dev, &handle)) != 0) {
					serial = libusb_error_name(r);
				} else {
					if (desc.iSerialNumber && (libusb_get_string_descriptor_ascii(handle, desc.iSerialNumber, buf, sizeof(buf)) > 0)) {
						serial = (char *)buf;
					}
					libusb_close(handle);
				}
				printf(_("%s\tserial %s\t(USB bus %d, device %d)%s\n"),
					ptdevs[k].name, serial,
					libusb_get_bus_number(dev),
					libusb_get_device_address(dev),
					(ptdevs[k].flags & FLAG_PLITE) ? _(" - in P-Lite mode, unsupported") :
					(ptdevs[k].flags & FLAG_UNSUP_RASTER) ? _(" - unsupported") : "");
				++found;
				break;
			}
		}
	}
	libusb_free_device_list(devs, 1);
	libusb_exit(NULL);
	return found;
}

const char* pt_mediatype(const uint8_t media_type)
{
	switch (media_type) {
		case 0x00: return "No media"; break;
		case 0x01: return "Laminated tape"; break;
		case 0x03: return "Non-laminated tape"; break;
		case 0x04: return "Fabric tape"; break;
		case 0x11: return "Heat-shrink tube"; break; // Seems wrong, should be 0x17
		case 0x13: return "Flexi tape"; break;
		case 0x14: return "Flexible ID tape"; break;
		case 0x15: return "Satin tape"; break;
		case 0x17: return "Heat-shrink tube"; break;
		case 0xff: return "Incompatible tape"; break;
		default: return "unknown";
	}
}

const char* pt_tapecolor(const uint8_t tape_color)
{
	switch (tape_color) {
		case 0x01: return "White"; break;
		case 0x02: return "Other"; break;
		case 0x03: return "Clear"; break;
		case 0x04: return "Red"; break;
		case 0x05: return "Blue"; break;
		case 0x06: return "Yellow"; break;
		case 0x07: return "Green"; break;
		case 0x08: return "Black"; break;
		case 0x09: return "Clear"; break;
		case 0x20: return "Matte White"; break;
		case 0x21: return "Matte Clear"; break;
		case 0x22: return "Matte Silver"; break;
		case 0x23: return "Satin Gold"; break;
		case 0x24: return "Satin Silver"; break;
		case 0x30: return "Blue (TZe-5[345]5)"; break;
		case 0x31: return "Red (TZe-435)"; break;
		case 0x40: return "Fluorescent Orange"; break;
		case 0x41: return "Fluorescent Yellow"; break;
		case 0x50: return "Berry Pink (TZe-MQP35)"; break;
		case 0x51: return "Light Gray (TZe-MQL35)"; break;
		case 0x52: return "Lime Green (TZe-MQG35)"; break;
		case 0x60: return "Yellow"; break;
		case 0x61: return "Pink"; break;
		case 0x62: return "Blue"; break;
		case 0x70: return "Heat-shrink Tube"; break;
		case 0x71: return "Heat-shrink Tube white"; break;
		case 0x90: return "White(Flex. ID)"; break;
		case 0x91: return "Yellow(Flex. ID)"; break;
		case 0xf0: return "Cleaning"; break;
		case 0xf1: return "Stencil"; break;
		case 0xff: return "Incompatible"; break;
		default: return "unknown";
	}
}

const char* pt_textcolor(const uint8_t text_color)
{
	switch (text_color) {
		case 0x01: return "White"; break;
		case 0x02: return "Other"; break;
		case 0x04: return "Red"; break;
		case 0x05: return "Blue"; break;
		case 0x08: return "Black"; break;
		case 0x0a: return "Gold"; break;
		case 0x62: return "Blue(F)"; break;
		case 0xf0: return "Cleaning"; break;
		case 0xf1: return "Stencil"; break;
		case 0xff: return "Incompatible"; break;
		default: return "unknown";
	}
}
