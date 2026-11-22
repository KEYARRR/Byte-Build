# ByteBuild Compatibility & Validation Rules

All compatibility rules return one of four explicit statuses:
- `pass`: Rule condition satisfied with available specifications.
- `warn`: Suboptimal configuration, headroom warning, or non-blocking advisory.
- `fail`: Hard compatibility conflict or unmet requirement.
- `unknown`: Required specification is missing or null (never silently treated as `pass`).

| Rule ID | Category | Severity | Inputs | Description |
| --- | --- | --- | --- | --- |
| `RULE-SOCK-01` | Motherboards | `fail` | `Processors.socket`, `Motherboards.socket` | CPU socket must match motherboard socket |
| `RULE-MEM-01` | Memory | `fail` | `Memory.memory_type`, `Motherboards.memory_type` | RAM generation (DDR4/DDR5) must match motherboard memory support |
| `RULE-STOR-01` | Storage | `warn` | `Storage.capacity_gb`, `Storage.specs` | Primary storage should be an SSD with at least 500GB capacity |
| `RULE-PSU-01` | Power Supplies | `fail` | `Power Supplies.wattage`, `Power Supplies.psu_tier`, `estimatedPeakWatts` | PSU wattage must cover estimated peak draw and tier requirements |
| `RULE-GPU-LEN-01` | Cases | `fail` | `Video Cards.length_mm`, `Cases.max_gpu_length_mm` | GPU length must fit within case maximum GPU clearance |
| `RULE-CLR-HGT-01` | CPU Coolers | `fail` | `CPU Coolers.cooler_height_mm`, `Cases.max_cooler_height_mm` | Air cooler height must fit within case maximum cooler clearance |
| `RULE-MFF-01` | Cases | `fail` | `Motherboards.form_factor`, `Cases.supported_form_factors` | Motherboard form factor must be supported by the case |
| `RULE-SLOTS-01` | Storage | `warn` | `Motherboards.m2_slots`, `Motherboards.sata_ports`, `Storage.storage_interface` | Motherboard M.2/SATA slot counts should cover selected storage interfaces |
| `RULE-PSU-CONN-01` | Power Supplies | `fail` | `Power Supplies.pcie_8pin_count`, `Power Supplies.has_12vhpwr`, `Video Cards.gpu_pcie_8pin_req`, `Video Cards.gpu_requires_12vhpwr` | PSU PCIe 8-pin / 12VHPWR connectors must cover GPU power connectors |
| `RULE-CLR-SOCK-01` | CPU Coolers | `fail` | `CPU Coolers.supported_sockets`, `Processors.socket` | CPU cooler must support the selected CPU socket |
| `RULE-RAM-LIM-01` | Memory | `warn` | `Memory.capacity_gb`, `Memory.speed_mhz`, `Motherboards.max_ram_gb`, `Motherboards.max_ram_mhz` | Total RAM capacity and speed should not exceed motherboard limits |
| `RULE-IGPU-01` | Video Cards | `warn` | `Video Cards`, `Processors.has_igpu` | Display output requires a discrete GPU or a CPU with integrated graphics |