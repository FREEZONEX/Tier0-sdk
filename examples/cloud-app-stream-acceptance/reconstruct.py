#!/usr/bin/env python3
"""Reconstruct the acceptance source from the reviewed Scaffold ZIP, never SDK HEAD."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
SDK_ROOT = HERE.parent.parent
ARCHIVE_NAME = 'Tier0-SDK-Acceptance-v11-57d6ee4-7f0a82e-source.zip'


class VerificationError(ValueError):
    pass


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def archive_members(body):
    members = {}
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            require(not path.is_absolute() and '..' not in path.parts
                    and '\\' not in entry.filename and path.parts[0] == 'scaffold',
                    'Unsafe source ZIP member')
            require(not stat.S_ISLNK(entry.external_attr >> 16), 'Source ZIP has a symlink')
            if entry.is_dir():
                continue
            require(len(path.parts) > 1, 'Invalid source ZIP member')
            name = path.relative_to('scaffold').as_posix()
            require(name not in members, 'Duplicate source ZIP member')
            members[name] = archive.read(entry)
    return members


def source_zip(members, date_time):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, body in sorted(members.items(), key=lambda item: PurePosixPath(item[0]).parts):
            entry = zipfile.ZipInfo('scaffold/' + name, date_time=tuple(date_time))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, body)
    return buffer.getvalue()


def prepare(base_zip, private_metadata=None):
    provenance = json.loads((HERE / 'provenance.json').read_text())
    raw_manifest = (HERE / 'source-member-manifest.json').read_bytes()
    require(sha256(raw_manifest) == provenance['source']['memberManifestSHA256'],
            'Member manifest hash mismatch')
    expected = json.loads(raw_manifest)
    base = Path(base_zip).read_bytes()
    require(sha256(base) == provenance['base']['sha256'], 'Reviewed Scaffold ZIP hash mismatch')
    members = archive_members(base)
    require(len(members) == provenance['base']['sourceFiles'], 'Unexpected base file count')
    original = members.copy()
    overlay = provenance['overlay']
    expected_overlay = set(overlay['modified'] + overlay['added'])
    require(set(overlay['sha256']) == expected_overlay and len(expected_overlay) == 8,
            'Overlay must contain exactly eight declared fixture files')
    actual_overlay = {p.relative_to(HERE / 'overlay').as_posix()
                      for p in (HERE / 'overlay').rglob('*') if p.is_file()}
    storage = overlay['files']
    require(set(storage) == expected_overlay and actual_overlay == set(storage.values()),
            'Unexpected overlay file set')
    for name in sorted(expected_overlay):
        file = HERE / 'overlay' / storage[name]
        require(not file.is_symlink(), 'Overlay symlink is not allowed')
        body = file.read_bytes()
        require(sha256(body) == overlay['sha256'][name], 'Overlay member hash mismatch: ' + name)
        require((name in original) == (name in overlay['modified']), 'Invalid overlay classification')
        members[name] = body
    require(all(members[name] == body for name, body in original.items()
                if name not in overlay['modified']), 'Protected Scaffold source changed')
    sdk = provenance['sdkArtifact']
    require(sha256(members[sdk['member']]) == sdk['sha256'], 'Frozen SDK artifact hash mismatch')
    pkg = json.loads(members['package.json'])
    require(pkg['dependencies']['@tier0/sdk'] == 'file:' + sdk['member'], 'SDK artifact pin changed')
    require(pkg['dependencies']['@tier0/sdk-v2'] == sdk['dataDependency'], 'Data SDK pin changed')
    require(pkg['tier0Scaffold'] == provenance['base']['preservedScaffoldMarker'], 'Scaffold marker changed')
    locked = json.loads(members['scripts/gate-integrity.json'])['locked']
    require(len(locked) == 32 and all(sha256(members[n]) == digest for n, digest in locked.items()),
            'Locked Scaffold gates changed')
    require(members['icon.png'] == members['public/app-icon.png'], 'Icon copies differ')
    require({name: sha256(body) for name, body in members.items()} == expected,
            'Reconstructed members differ from the reviewed manifest')
    target = provenance['source']
    if private_metadata is not None:
        historical = provenance['historicalPrivateSource']
        body = Path(private_metadata).read_bytes()
        require(sha256(body) == historical['privateMetadataSHA256'], 'Private metadata hash mismatch')
        name = historical['privateMetadataMember']
        members[name] = body
        expected[name] = historical['privateMetadataSHA256']
        target = historical
    archive = source_zip(members, provenance['source']['zipDateTime'])
    require(sha256(archive) == target['sha256'] and len(archive) == target['bytes'],
            'ZIP byte identity failed (check Python/zlib compatibility); refusing unverified output')
    require(len(members) == provenance['source']['sourceFiles'], 'Reconstructed file count mismatch')
    expected = {name: sha256(members[name]) for name in sorted(members, key=lambda n: PurePosixPath(n).parts)}
    return members, expected, archive, provenance


def reconstruct(base_zip, output_dir, private_metadata=None):
    output = Path(output_dir)
    require(output.is_absolute(), 'Provide an absolute output directory')
    output = output.resolve()
    require(output != SDK_ROOT and SDK_ROOT not in output.parents, 'Output must be outside the SDK checkout')
    require(not output.exists(), 'Output directory already exists; refusing to overwrite')
    members, manifest, archive, provenance = prepare(base_zip, private_metadata)
    output.mkdir(mode=0o700)
    for name, body in members.items():
        file = output / 'scaffold' / name
        file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        file.write_bytes(body)
        file.chmod(0o600)
    files = {
        ARCHIVE_NAME: archive,
        ARCHIVE_NAME + '.sha256': (sha256(archive) + '  ' + ARCHIVE_NAME + '\n').encode(),
        'source-member-manifest.json': json_bytes(manifest),
        'reconstruction-provenance.json': json_bytes({
            'baseSHA256': provenance['base']['sha256'],
            'sdkArtifactCommit': provenance['sdkArtifact']['commit'],
            'sdkArtifactSHA256': provenance['sdkArtifact']['sha256'],
            'sourceSHA256': sha256(archive),
            'sourceFiles': len(members),
            'privateMetadataSupplied': private_metadata is not None,
            'overlayHashes': provenance['overlay']['sha256'],
            'build': 'NOT_RUN', 'browserAcceptance': 'NOT_RUN', 'ACKAcceptance': 'UNVERIFIED',
        }),
    }
    for name, body in files.items():
        file = output / name
        file.write_bytes(body)
        file.chmod(0o600)
    return output


def build(output):
    app = output / 'scaffold'
    commands = [
        ('install.log', ['npm', 'ci', '--no-audit', '--no-fund']),
        ('build.log', ['npm', 'run', 'build']),
        ('fixture-tests.log', ['node', '--import', 'tsx', '--test', 'tests/sdk-acceptance-fixture.test.ts']),
    ]
    # No platform credentials or browser build variables are needed for these offline checks.
    env = {key: os.environ[key] for key in ('PATH', 'HOME') if key in os.environ}
    for log_name, command in commands:
        log = output / log_name
        with log.open('w') as stream:
            log.chmod(0o600)
            print('Running: ' + ' '.join(command), flush=True)
            subprocess.run(command, cwd=app, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)
    manifest = json.loads((output / 'source-member-manifest.json').read_text())
    require(all(sha256((app / name).read_bytes()) == digest for name, digest in manifest.items()),
            'Build changed packaged source members')
    file = output / 'reconstruction-provenance.json'
    result = json.loads(file.read_text())
    result['build'] = 'PASS'
    result['evidenceSHA256'] = {name: sha256((output / name).read_bytes()) for name, _ in commands}
    file.write_bytes(json_bytes(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-zip', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--private-metadata', type=Path,
                        help='Optional original private JSON, accepted only at its pinned hash')
    parser.add_argument('--build', action='store_true', help='Run npm ci, full App build/gates and fixture tests')
    args = parser.parse_args()
    try:
        output = reconstruct(args.base_zip, args.output_dir, args.private_metadata)
        if args.build:
            build(output)
        print(output / ARCHIVE_NAME)
        print('Source SHA-256: ' + sha256((output / ARCHIVE_NAME).read_bytes()))
    except (VerificationError, OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print('Reconstruction failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
