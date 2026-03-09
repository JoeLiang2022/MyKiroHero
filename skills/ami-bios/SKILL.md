---
name: ami-bios
description: >
  AMI Aptio V BIOS codebase knowledge — SDL/CIF/VEB formats, package structure, build system, customization patterns.
  Triggers: ami, aptio, bios, uefi, sdl, cif, veb, agesa, firmware, elink, token, setup, board, platform
version: 1.0.0
allowed-tools: []
---

# AMI Aptio V BIOS Knowledge

## Overview

AMI Aptio V is a commercial UEFI BIOS framework built on top of EDK2. It adds proprietary build tools (SDL, CIF, VEB), a component-based architecture, and extensive hook/extension mechanisms (ELINK).

Key difference from pure EDK2: AMI uses SDL tokens for feature flags and build configuration, CIF for component metadata, and VEB for project-level build definitions.

---

## AMI-Specific File Types

| Extension | Purpose |
|-----------|---------|
| `.sdl` | Setup Description Language — TOKEN definitions, ELINK hooks, feature flags, build controls |
| `.cif` | Component Information File — module metadata, dependencies, file lists, version info |
| `.veb` | Visual eBIOS — project build config, board flavor, AMI core version |
| `.sd` | Setup Data — HII/VFR-like setup screen definitions (AMI format, not standard VFR) |
| `.uni` | Unicode strings — multi-language UI text for setup screens |
| `.mak` | Makefile fragments — build rules consumed by AMI build system |

Standard EDK2 files also present: `.inf`, `.dsc`, `.fdf`, `.dec`, `.c`, `.h`

---

## SDL Format

### TOKEN — Feature flags
```
TOKEN
    Name  = "FEATURE_NAME"
    Value  = "1"
    Help  = "Enable/disable feature"
    TokenType = Boolean        # Boolean, Integer, Expression, File
    TargetMAK = Yes            # generates to makefile
    TargetH = Yes              # generates to .h header
    TargetDSC = Yes            # generates to .dsc
    Token = "CONDITION" "=" "1"  # conditional activation
End
```

### ELINK — Hook/extension points
```
ELINK
    Name  = "HookFunctionList"
    Parent = "ParentHookList"
    InvokeOrder = AfterParent   # AfterParent, BeforeParent, ReplaceParent
    Help  = "Description"
End
```
ELINKs create parent/child chains for extensibility. OEM/ODM code hooks into AMI core via ELINKs.

### Other SDL blocks
- `PATH` — include paths
- `MODULE` — module definitions
- `OUTPUTREGISTER` — build output registration
- `PCIDEVICE` — PCI device declarations

---

## CIF Format — Component Metadata
```
<component>
    name = "PackageName"
    category = eCore              # eCore, eChipset, eBoard, eModule
    LocalRoot = "PackageName/"
    RefName = "PackageName"
[files]                           # files in this component
[parts]                           # sub-components
[dependency]                      # required packages with version
[dependency.optional]
[dependency.incompatible]
<endComponent>
```

---

## VEB Format — Project Build Config
```
[project]
    Build = "make"
    BuildAll = "make rebuild"
    BuildDir = "Build"
    BoardFlavor = "PlatformName"
    ProjectType = "AptioV"
[files]                           # CIF references
```
Multiple `.veb` files = multiple build variants (different boards or AMI core versions).

---

## Typical Package Structure

### AMI Core (vendor-provided, rarely modified)
- `AmiPkg` — core infrastructure
- `AmiModulePkg` — main features (ACPI, AHCI, PCI, USB, Flash, NVRAM, SecureBoot, TCG2, Terminal)
- `AmiCompatibilityPkg` — legacy (SMBIOS, Setup, CMOS)
- `AmiChipsetPkg` / `AmiChipsetModulePkg` — chipset abstraction
- `AmiCpuPkg` — CPU setup
- `AmiCryptoPkg` — crypto services
- `AmiTsePkg` — TSE (Text Setup Environment) — BIOS Setup UI engine
- `AmiSecureBootPkg`, `AmiTcgPkg`, `AmiTrustedFvPkg` — security

### Silicon Vendor (AMD/Intel specific)
- AMD: `AGESA` (AgesaModulePkg), `AmdCpmPkg`, wrapper packages
- Intel: similar pattern with Intel RC packages

### Platform / Board (ODM-specific)
- `{Platform}Pkg` — SoC platform code
- `{Platform}Board` — board-specific configs, multiple SKU variants
- Each board variant has its own `BoardPkg` + platform data (APCB/UPD)

### OEM Customization
- `{OEM}CorePkg` — OEM's core features (BMC, Setup, Boot, Security, Display, ACPI, SMBIOS)
- `{OEM}PlatformPkg` — platform-specific OEM features

### Server Management (if server-class)
- `AmiIpmi2Pkg` — IPMI 2.0
- `AmiRedfishPkg` — Redfish REST API
- `AmiServerModulePkg` — Hardware Health Management
- `PldmPkg` — PLDM protocol

---

## Common Patterns

### Multi-board support
- `PLATFORM_SELECT` token (integer) selects board variant
- Each board has conditional SDL tokens gated on PLATFORM_SELECT
- Board-specific packages under `{Platform}Board/{BoardName}/`

### Build variants
- Multiple `.veb` files for different configurations
- May use different AMI core versions (e.g., Core_5.39 vs Core_5.40)

### OEM customization layers
- OEM hooks into AMI core via ELINKs
- OEM SDL tokens override AMI defaults
- OEM packages depend on AMI core but can replace behaviors via `InvokeOrder = ReplaceParent`

---

## Analysis SOP

1. **Read top-level .sdl** → find `PLATFORM_SELECT` and major feature tokens
2. **List directories** → identify packages and board variants
3. **Read .veb files** → understand build variants and AMI core versions
4. **Read .cif files** → understand module dependencies and categories
5. **Scan OEM packages** → find customer customizations (largest value-add)
6. **Read .sd files** → understand Setup menu structure and options
7. **Check server packages** → IPMI/Redfish/Security features
8. **Read board packages** → board-specific configurations and GPIO/topology

---

## Knowledge Base Reference

For detailed study notes from JabilVenice1S (AMD Venice/Zen6), query:
`knowledge({ action: "get", id: "ami-aptio-v-architecture" })`