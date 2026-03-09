---
name: ami-bios-analyzer
description: >
  SOP for analyzing AMI Aptio V BIOS codebases. Auto-triggers when working with AMI BIOS repositories.
  Use when: analyzing BIOS source code, studying AMI repos, listing firmware features, reviewing SDL/CIF/VEB files.
---

# AMI BIOS Codebase Analyzer

You are analyzing an AMI Aptio V BIOS codebase. This is a commercial UEFI firmware framework with proprietary file formats on top of EDK2.

## Key File Types to Recognize

- `.sdl` — AMI Setup Description Language (TOKEN definitions, ELINK hooks, feature flags)
- `.cif` — Component Information File (module metadata, dependencies)
- `.veb` — Visual eBIOS (project build config, board flavor)
- `.sd` — Setup Data (BIOS setup screen definitions, AMI format)
- `.uni` — Unicode strings (multi-language UI text)
- `.mak` — Makefile fragments
- Standard EDK2: `.inf`, `.dsc`, `.fdf`, `.dec`, `.c`, `.h`

## Analysis SOP (follow in order)

### Step 1: Identify Build Variants
- Find all `.veb` files at the top level
- Read each `.veb` → note `BoardFlavor`, `ProjectType`, AMI core version
- Multiple `.veb` = multiple build configurations

### Step 2: Map Feature Tokens
- Read top-level `.sdl` files (especially the main platform SDL)
- Find `PLATFORM_SELECT` token → identifies board variants
- List major feature tokens (Boolean type with `TargetH = Yes`)
- Note conditional tokens (gated on other token values)

### Step 3: Identify Packages
- List top-level directories
- Categorize by type:
  - **AMI Core**: `Ami*Pkg` (vendor-provided, rarely modified)
  - **Silicon**: `AGESA`, `Amd*Pkg`, `Intel*Pkg` (silicon vendor code)
  - **Platform**: `{Platform}Pkg`, `{Platform}SoCPkg` (SoC platform)
  - **Board**: `{Platform}Board/{BoardName}/` (board-specific)
  - **OEM**: `{OEM}CorePkg`, `{OEM}PlatformPkg` (customer customizations)
  - **Server Mgmt**: `AmiIpmi*`, `AmiRedfish*`, `PldmPkg`
  - **Security**: `AmiSecureBoot*`, `AmiTcg*`, `AmiTrustedFv*`
  - **EDK2 Standard**: `MdePkg`, `MdeModulePkg`, `CryptoPkg`, etc.

### Step 4: Analyze OEM Customizations
- This is where the most value is — OEM packages contain customer-specific features
- Scan OEM CorePkg subdirectories for module names
- Read `.cif` files to understand dependencies
- Group by function: BMC, Setup, Boot, Security, Display, ACPI, SMBIOS, etc.

### Step 5: Map Setup Menu
- Read `.sd` files to understand BIOS Setup structure
- Note setup forms, options, and their controlling tokens
- Read corresponding `.uni` files for display strings

### Step 6: Check Server Features (if applicable)
- IPMI: `AmiIpmi2Pkg` → BMC communication, SEL, SDR, FRU, power control
- Redfish: `AmiRedfishPkg` → REST API for remote management
- HHM: Hardware Health Management → sensor monitoring
- RAS: Reliability/Availability/Serviceability
- PFR: Platform Firmware Resilience

### Step 7: Board Variants
- List all board directories under `{Platform}Board/`
- Each board has its own `BoardPkg` with GPIO, topology, APCB/UPD data
- Note which boards share common platform code vs. have unique features

## Output Format

When reporting analysis results, organize as:

1. **Platform Overview** — SoC, CPU arch, chipset, AMI core version
2. **Build Variants** — list of .veb configs
3. **Board Variants** — list of supported boards/SKUs
4. **Package Map** — categorized package list
5. **OEM Features** — grouped by function area
6. **Server Management** — IPMI/Redfish/HHM capabilities
7. **Security** — SecureBoot, TPM, TrustedFV, HSTI
8. **Key Observations** — anything notable or unusual

## Reference

For AMI architecture knowledge, load the custom skill:
`skill({ action: "load", name: "ami-bios" })`

For detailed study notes from a real codebase:
`knowledge({ action: "get", id: "ami-aptio-v-architecture" })`