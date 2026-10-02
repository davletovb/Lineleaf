"""Packaging integrity and fail-closed coexistence report boundaries."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts.package import deterministic_zip
from tools import validate_authorization, validate_coexistence
from tools.seatline_wire import ProtocolError


class PackageTests(unittest.TestCase):
    def test_archive_is_reproducible_and_contains_only_sorted_input_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            (source / 'z.json').write_text('{"synthetic":true}')
            (source / 'a').mkdir()
            (source / 'a/manifest.json').write_text('{"version":"0.1.0"}')
            first, second = root / 'one.zip', root / 'two.zip'
            deterministic_zip(source, first)
            (source / 'z.json').touch()
            deterministic_zip(source, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.namelist(), ['a/manifest.json', 'z.json'])
                self.assertEqual(archive.read('z.json'), b'{"synthetic":true}')
                self.assertTrue(all(i.date_time == (2026, 1, 1, 0, 0, 0) for i in archive.infolist()))

    def test_symlink_missing_input_and_self_containment_cannot_replace_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            target = root / 'archive.zip'
            target.write_bytes(b'previous-valid-artifact')
            (source / 'linked').symlink_to(target)
            for input_dir, output in [(source, target), (root / 'absent', target), (source, source / 'self.zip')]:
                with self.assertRaises(ValueError):
                    deterministic_zip(input_dir, output)
            self.assertEqual(target.read_bytes(), b'previous-valid-artifact')
            self.assertEqual(list(root.glob('.lineleaf-package-*')), [])

    def test_read_failure_leaves_previous_archive_and_removes_temporary_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            (source / 'file').write_text('synthetic')
            target = root / 'archive.zip'
            target.write_bytes(b'previous-valid-artifact')
            with patch.object(Path, 'read_bytes', side_effect=OSError('incomplete read')):
                with self.assertRaises(OSError):
                    deterministic_zip(source, target)
            self.assertEqual(target.read_bytes(), b'previous-valid-artifact')
            self.assertEqual(list(root.glob('.lineleaf-package-*')), [])


class CoexistenceReportTests(unittest.TestCase):
    def test_incomplete_false_or_complete_native_checks_keep_fixture_boundary(self):
        for checks, expected in [({}, 'failed'), ({validate_coexistence.CHECKS[0]: True}, 'failed'),
                                 (dict.fromkeys(validate_coexistence.CHECKS, False), 'failed'),
                                 (dict.fromkeys(validate_coexistence.CHECKS, True), 'passed')]:
            def exercise(_binary, _provider, _contract, report, *, coexistence):
                self.assertTrue(coexistence)
                report['checks']['registry-fixture'] = True
                report['coexistence_checks'].update(checks)
            with patch.object(validate_authorization.sys, 'platform', 'linux'), \
                    patch.object(validate_authorization, 'exercise', exercise):
                report = validate_authorization.validate('/unused', '/unused-fixture', coexistence=True)
            self.assertEqual(report['status'], expected)
            self.assertEqual(report['kind'], 'native-coexistence-fixture')
            self.assertFalse(report['release_eligible'])

    def test_wire_failure_preserves_partial_checks_without_private_diagnostics(self):
        def exercise(_binary, _provider, _contract, report, *, coexistence):
            report['coexistence_checks'][validate_coexistence.CHECKS[0]] = True
            raise ProtocolError('private session or provider output')
        with patch.object(validate_authorization.sys, 'platform', 'linux'), \
                patch.object(validate_authorization, 'exercise', exercise):
            report = validate_authorization.validate('/unused', '/unused-fixture', coexistence=True)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['reason'], 'ProtocolError')
        self.assertEqual(report['coexistence_checks'], {validate_coexistence.CHECKS[0]: True})
        self.assertNotIn('private session', str(report))


if __name__ == '__main__':
    unittest.main()
