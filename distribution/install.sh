#!/bin/sh
# Licensed under the Apache License, Version 2.0.
set -eu

manifest_url="${MARCUS_RELEASE_MANIFEST_URL:-}"
prefix="${HOME}/.marcus"
system_install=false

status() {
  printf '[marcus] %s\n' "$*" >&2
}

download_file() {
  download_url="$1"
  download_destination="$2"
  if [ -t 2 ]; then
    curl --fail --location --show-error --progress-bar "$download_url" -o "$download_destination"
  else
    curl -fsSL "$download_url" -o "$download_destination"
  fi
}

format_size() {
  awk -v bytes="$1" 'BEGIN {
    split("B KiB MiB GiB", units, " ");
    value = bytes + 0;
    unit = 1;
    while (value >= 1024 && unit < 4) { value /= 1024; unit += 1; }
    if (unit == 1) printf "%d %s", value, units[unit];
    else printf "%.1f %s", value, units[unit];
  }'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest-url) manifest_url="$2"; shift 2 ;;
    --prefix) prefix="$2"; shift 2 ;;
    --system) prefix="/usr/local"; system_install=true; shift ;;
    *) printf 'Unknown installer option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ -z "$manifest_url" ]; then
  printf 'Use --manifest-url URL or MARCUS_RELEASE_MANIFEST_URL.\n' >&2
  exit 2
fi
command -v curl >/dev/null 2>&1 || { printf 'curl is required.\n' >&2; exit 3; }
command -v python3 >/dev/null 2>&1 || { printf 'python3 is required to read the release inventory.\n' >&2; exit 3; }
command -v tar >/dev/null 2>&1 || { printf 'tar is required to unpack the release.\n' >&2; exit 3; }

case "$(uname -s)" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *) printf 'This installer supports Linux and macOS.\n' >&2; exit 4 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) architecture="x64" ;;
  arm64|aarch64) architecture="arm64" ;;
  *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 4 ;;
esac

if [ "$system_install" = true ]; then
  if [ "$platform" != "linux" ]; then
    printf 'Automatic service installation is supported only on Linux.\n' >&2
    exit 6
  fi
  if [ "$(id -u)" -ne 0 ]; then
    printf 'Use sudo with --system so Marcus can install its user and services.\n' >&2
    exit 6
  fi
  command -v systemctl >/dev/null 2>&1 || { printf 'systemctl is required for --system.\n' >&2; exit 6; }
  if ! id marcus >/dev/null 2>&1; then
    command -v useradd >/dev/null 2>&1 || { printf 'useradd is required for --system.\n' >&2; exit 6; }
  fi
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
manifest="$temporary/release-manifest.json"
status "Preparando la instalación para $platform-$architecture en $prefix"
status 'Descargando el manifiesto de la release estable...'
download_file "$manifest_url" "$manifest"
base_url="${manifest_url%/*}"

python3 - "$manifest" "$temporary/inventory" "$temporary/bundle" "$temporary/bundle-parts" "$platform-$architecture" <<'PY'
import json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
if manifest.get("target") != sys.argv[5]:
    raise SystemExit(f"release target {manifest.get('target')} does not match {sys.argv[5]}")
if not isinstance(manifest.get("productVersion"), str) or not manifest["productVersion"]:
    raise SystemExit("release manifest has no product version")
protocols = manifest.get("protocols", {})
if protocols.get("mnp") != 1 or protocols.get("agentManifest") != "v1" or protocols.get("runtimeHost") != 1:
    raise SystemExit("release manifest has incompatible protocol versions")
required = {
    "marcus", "marcusd", "marcus-api", "marcus-runtime-host", "marcus-agent-process", "marcus-manifest-loader",
    "distribution/config/marcusd.json", "distribution/config/marcus-api.json",
    "distribution/systemd/marcusd.service", "distribution/systemd/marcus-api.service",
}
artifacts = {item["name"]: item for item in manifest.get("artifacts", [])}
missing = sorted(required - artifacts.keys())
if missing:
    raise SystemExit("release manifest is missing: " + ", ".join(missing))
bundle_name = manifest.get("distributionBundle")
bundle = artifacts.get(bundle_name)
if not isinstance(bundle_name, str) or not bundle_name or bundle is None:
    raise SystemExit("release manifest has no distribution bundle")
if "/" in bundle_name or bundle_name in {".", ".."}:
    raise SystemExit("release manifest has an invalid distribution bundle name")
if not isinstance(bundle.get("size"), int) or bundle["size"] < 1:
    raise SystemExit("release manifest has an invalid distribution bundle size")
if not isinstance(bundle.get("sha256"), str) or len(bundle["sha256"]) != 64:
    raise SystemExit("release manifest has an invalid distribution bundle checksum")
pathlib.Path(sys.argv[3]).write_text(f"{bundle['sha256']}\t{bundle['size']}\t{bundle_name}\t{manifest['productVersion']}\n")
parts = manifest.get("distributionBundleParts", [])
if not isinstance(parts, list):
    raise SystemExit("release manifest has an invalid distribution bundle parts list")
with pathlib.Path(sys.argv[4]).open("w") as output:
    total_size = 0
    for index, part in enumerate(parts):
        expected_name = f"{bundle_name}.part-{index:03d}"
        if not isinstance(part, dict) or part.get("name") != expected_name:
            raise SystemExit("release manifest has an invalid distribution bundle part name")
        if not isinstance(part.get("size"), int) or part["size"] < 1:
            raise SystemExit(f"release manifest has an invalid size for {expected_name}")
        if not isinstance(part.get("sha256"), str) or len(part["sha256"]) != 64:
            raise SystemExit(f"release manifest has an invalid checksum for {expected_name}")
        total_size += part["size"]
        output.write(f"{part['sha256']}\t{part['size']}\t{expected_name}\n")
    if parts and total_size != bundle["size"]:
        raise SystemExit("release bundle parts do not match the bundle size")
with pathlib.Path(sys.argv[2]).open("w") as output:
    for name in sorted(required):
        artifact = artifacts[name]
        if not isinstance(artifact.get("size"), int) or artifact["size"] < 0:
            raise SystemExit(f"release manifest has an invalid size for {name}")
        output.write(f"{artifact['sha256']}\t{artifact['size']}\t{name}\n")
PY

IFS="	" read -r bundle_sha256 bundle_size bundle_name product_version < "$temporary/bundle"
bundle="$temporary/$bundle_name"
: > "$bundle"
if [ -s "$temporary/bundle-parts" ]; then
  part_count="$(wc -l < "$temporary/bundle-parts" | tr -d ' ')"
  part_index=0
  status "Marcus $product_version requiere $part_count partes ($(format_size "$bundle_size") en total)."
  while IFS="	" read -r part_sha256 part_size part_name; do
    part_index=$((part_index + 1))
    downloaded_part="$temporary/$part_name"
    status "Descargando parte $part_index/$part_count: $part_name ($(format_size "$part_size"))"
    download_file "$base_url/$part_name" "$downloaded_part"
    status "Verificando parte $part_index/$part_count..."
    actual_part_size="$(wc -c < "$downloaded_part" | tr -d ' ')"
    if [ "$actual_part_size" != "$part_size" ]; then
      printf 'Size mismatch for %s\n' "$part_name" >&2
      exit 5
    fi
    if command -v sha256sum >/dev/null 2>&1; then
      actual_part_sha256="$(sha256sum "$downloaded_part" | awk '{print $1}')"
    else
      actual_part_sha256="$(shasum -a 256 "$downloaded_part" | awk '{print $1}')"
    fi
    if [ "$actual_part_sha256" != "$part_sha256" ]; then
      printf 'Checksum mismatch for %s\n' "$part_name" >&2
      exit 5
    fi
    cat "$downloaded_part" >> "$bundle"
    rm -f "$downloaded_part"
  done < "$temporary/bundle-parts"
else
  status "Descargando Marcus $product_version ($(format_size "$bundle_size"))..."
  download_file "$base_url/$bundle_name" "$bundle"
fi
status 'Verificando el archivo completo de la release...'
actual_bundle_size="$(wc -c < "$bundle" | tr -d ' ')"
if [ "$actual_bundle_size" != "$bundle_size" ]; then
  printf 'Size mismatch for %s\n' "$bundle_name" >&2
  exit 5
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual_bundle_sha256="$(sha256sum "$bundle" | awk '{print $1}')"
else
  actual_bundle_sha256="$(shasum -a 256 "$bundle" | awk '{print $1}')"
fi
if [ "$actual_bundle_sha256" != "$bundle_sha256" ]; then
  printf 'Checksum mismatch for %s\n' "$bundle_name" >&2
  exit 5
fi

status 'Inspeccionando el inventario de la release...'
tar -tzf "$bundle" > "$temporary/bundle-files"
python3 - "$temporary/bundle-files" "$temporary/inventory" <<'PY'
import pathlib, sys
listed = [line for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line]
required = [line.split("\t", 2)[2] for line in pathlib.Path(sys.argv[2]).read_text().splitlines() if line]
allowed = set(required) | {"LICENSE", "distribution/install.sh"}
if len(listed) != len(set(listed)) or set(listed) != allowed:
    raise SystemExit("release bundle inventory does not match its manifest")
for name in listed:
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit("release bundle contains an unsafe path")
PY
mkdir -p "$temporary/files"
status 'Descomprimiendo los archivos verificados...'
tar -xzf "$bundle" -C "$temporary/files"

artifact_count="$(wc -l < "$temporary/inventory" | tr -d ' ')"
status "Verificando $artifact_count archivos empaquetados..."
while IFS="	" read -r expected expected_size name; do
  if [ ! -f "$temporary/files/$name" ]; then
    printf 'Release bundle is missing %s\n' "$name" >&2
    exit 5
  fi
  actual_size="$(wc -c < "$temporary/files/$name" | tr -d ' ')"
  if [ "$actual_size" != "$expected_size" ]; then
    printf 'Size mismatch for %s\n' "$name" >&2
    exit 5
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$temporary/files/$name" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$temporary/files/$name" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    printf 'Checksum mismatch for %s\n' "$name" >&2
    exit 5
  fi
done < "$temporary/inventory"

if [ "$system_install" = true ] && ! id marcus >/dev/null 2>&1; then
  nologin_shell="$(command -v nologin || printf '/usr/sbin/nologin')"
  useradd --system --home-dir /var/lib/marcus --no-create-home --shell "$nologin_shell" marcus
fi

bindir="$prefix/bin"
libdir="$prefix/lib/marcus"
status "Instalando comandos públicos en $bindir..."
mkdir -p "$bindir" "$libdir"
for executable in marcus marcusd marcus-api; do
  install -m 0755 "$temporary/files/$executable" "$bindir/$executable.new.$$"
  mv -f "$bindir/$executable.new.$$" "$bindir/$executable"
done
for executable in marcus-runtime-host marcus-agent-process marcus-manifest-loader; do
  install -m 0755 "$temporary/files/$executable" "$libdir/$executable.new.$$"
  mv -f "$libdir/$executable.new.$$" "$libdir/$executable"
done
if [ "$system_install" = true ]; then
  status 'Instalando e iniciando los servicios de Linux...'
  install -d -m 0750 -o root -g marcus /etc/marcus
  if [ ! -e /etc/marcus/marcusd.json ]; then
    install -m 0640 -o root -g marcus "$temporary/files/distribution/config/marcusd.json" /etc/marcus/marcusd.json
  fi
  if [ ! -e /etc/marcus/marcus-api.json ]; then
    install -m 0640 -o root -g marcus "$temporary/files/distribution/config/marcus-api.json" /etc/marcus/marcus-api.json
  fi
  install -m 0644 "$temporary/files/distribution/systemd/marcusd.service" /etc/systemd/system/marcusd.service
  install -m 0644 "$temporary/files/distribution/systemd/marcus-api.service" /etc/systemd/system/marcus-api.service
  systemctl daemon-reload
  systemctl enable --now marcusd.service marcus-api.service
fi

version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["productVersion"])' "$manifest")"
status 'Instalación completada correctamente.'
printf 'Marcus %s installed for %s-%s.\n' "$version" "$platform" "$architecture"
if [ "$system_install" = false ]; then
  printf 'Marcus home: %s\n' "$prefix"
fi
printf 'Public executables: %s\n' "$bindir"
printf 'Runtime Host components: %s\n' "$libdir"
if [ "$system_install" = true ]; then
  printf 'Marcus daemon and API services are enabled.\n'
  printf '\n%s\n' 'Próximos pasos:'
  printf '%s\n' '1. Completá una sola vez el bootstrap del administrador:'
  printf '%s\n' "sudo $bindir/marcus 127.0.0.1:4242 --bootstrap-token-file /var/lib/marcus/bootstrap.token --command 'bootstrap setup --username admin'"
  printf '%s\n' '2. Abrí la CLI de Marcus:'
  printf '%s\n' "$bindir/marcus 127.0.0.1:4242 --username admin --password"
  printf '%s\n' '3. Consultá el estado del daemon y la API:'
  printf '%s\n' 'systemctl status marcusd marcus-api'
else
  printf '\n%s\n' 'Próximos pasos:'
  printf '%s\n' '0. Agregá los comandos de Marcus a esta terminal:'
  printf '  export PATH="%s:$PATH"\n' "$bindir"
  printf '%s\n' '1. Terminal 1 — iniciá el daemon y dejalo ejecutándose:'
  printf '  %s/marcusd\n' "$bindir"
  printf '%s\n' '2. Terminal 2 — completá una sola vez el bootstrap del administrador:'
  printf '  %s/marcus 127.0.0.1:4242 --bootstrap-token-file %s/bootstrap.token --command '\''bootstrap setup --username admin'\''\n' "$bindir" "$prefix"
  printf '%s\n' '3. Terminal 2 — iniciá Marcus API y dejala ejecutándose:'
  printf '  %s/marcus-api\n' "$bindir"
  printf '%s\n' '4. Terminal 3 — abrí la CLI de Marcus:'
  printf '  %s/marcus 127.0.0.1:4242 --username admin --password\n' "$bindir"
fi
printf '\n%s\n' 'Backoffice (se instala por separado):'
printf '%s\n' '  Desde un checkout del código de Marcus ejecutá: bun run backoffice'
printf '%s\n' '  Luego abrí: http://127.0.0.1:6636'
printf '%s\n' '  El Backoffice no está incluido en este instalador.'
