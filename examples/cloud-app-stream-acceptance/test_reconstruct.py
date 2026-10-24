#!/usr/bin/env python3
"""Focused reconstruction checks; private historical inputs are optional and never fixtures in Git."""
import argparse
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from reconstruct import (ARCHIVE_NAME, HERE, VerificationError, archive_members,
                         prepare, reconstruct, sha256)


class ReconstructionTests(unittest.TestCase):
    def test_canonical_zip_and_every_member_match_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = reconstruct(ARGS.base_zip, Path(temporary) / 'canonical')
            provenance = json.loads((HERE / 'provenance.json').read_text())
            body = (output / ARCHIVE_NAME).read_bytes()
            self.assertEqual(sha256(body), provenance['source']['sha256'])
            expected = json.loads((HERE / 'source-member-manifest.json').read_text())
            self.assertEqual({name: sha256(data) for name, data in archive_members(body).items()}, expected)
            self.assertEqual(json.loads((output / 'source-member-manifest.json').read_text()), expected)
            metadata = json.loads((output / 'scaffold/acceptance-fixture.json').read_text())
            self.assertNotIn('inventoryWorkspaceAuditOnly', metadata)
            self.assertEqual(metadata['browserAcceptance'], 'NOT_RUN')
            self.assertEqual(metadata['ACKAcceptance'], 'UNVERIFIED')

    def test_only_three_base_members_change_and_five_are_added(self):
        members, _, _, provenance = prepare(ARGS.base_zip)
        original = archive_members(ARGS.base_zip.read_bytes())
        self.assertEqual(sorted(n for n in original if original[n] != members[n]),
                         provenance['overlay']['modified'])
        self.assertEqual(sorted(set(members) - set(original)), provenance['overlay']['added'])
        self.assertEqual(len(provenance['overlay']['files']), 8)
        self.assertTrue(all(name.endswith('.fixture') for name in provenance['overlay']['files'].values()
                            if '.test.' in name))

    def test_wrong_base_is_rejected_before_any_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / 'wrong.zip'
            base.write_bytes(ARGS.base_zip.read_bytes() + b'changed')
            with self.assertRaisesRegex(VerificationError, 'Scaffold ZIP hash'):
                reconstruct(base, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_unapproved_private_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata = root / 'unapproved.json'
            metadata.write_text('{}')
            with self.assertRaisesRegex(VerificationError, 'Private metadata hash'):
                reconstruct(ARGS.base_zip, root / 'output', metadata)
            self.assertFalse((root / 'output').exists())

    def test_existing_or_checkout_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            marker = output / 'owned-file'
            marker.write_text('keep')
            with self.assertRaisesRegex(VerificationError, 'already exists'):
                reconstruct(ARGS.base_zip, output)
            self.assertEqual(marker.read_text(), 'keep')
        with self.assertRaisesRegex(VerificationError, 'outside the SDK checkout'):
            reconstruct(ARGS.base_zip, HERE / 'output')
        with self.assertRaisesRegex(VerificationError, 'absolute'):
            reconstruct(ARGS.base_zip, Path('relative-output'))

    def test_source_zip_rejects_path_escape_and_symlink(self):
        for name, mode in [('scaffold/../../escape', 0o100644), ('scaffold/link', 0o120777)]:
            with self.subTest(name=name):
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, 'w') as archive:
                    info = zipfile.ZipInfo(name)
                    info.external_attr = mode << 16
                    archive.writestr(info, b'not a backend response')
                with self.assertRaises(VerificationError):
                    archive_members(buffer.getvalue())

    def test_historical_private_source_is_byte_identical(self):
        if ARGS.private_metadata is None:
            self.skipTest('Private historical inputs were not supplied')
        with tempfile.TemporaryDirectory() as temporary:
            output = reconstruct(ARGS.base_zip, Path(temporary) / 'historical', ARGS.private_metadata)
            self.assertEqual((output / ARCHIVE_NAME).read_bytes(), ARGS.reference_source_zip.read_bytes())
            self.assertEqual((output / 'source-member-manifest.json').read_bytes(),
                             ARGS.reference_member_manifest.read_bytes())
            provenance = json.loads((HERE / 'provenance.json').read_text())['historicalPrivateSource']
            self.assertEqual(sha256(ARGS.reference_member_manifest.read_bytes()),
                             provenance['privateMemberManifestFileSHA256'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-zip', type=Path, required=True)
    parser.add_argument('--private-metadata', type=Path)
    parser.add_argument('--reference-source-zip', type=Path)
    parser.add_argument('--reference-member-manifest', type=Path)
    ARGS = parser.parse_args()
    private_inputs = (ARGS.private_metadata, ARGS.reference_source_zip, ARGS.reference_member_manifest)
    if any(private_inputs) and not all(private_inputs):
        parser.error('Supply all three private historical inputs together')
    unittest.main(argv=['test_reconstruct.py'], verbosity=2)
