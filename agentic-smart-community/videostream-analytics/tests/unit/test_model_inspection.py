"""`inspect_ov_model` — the detection-layout verdict behind model swapping.

`_postprocess` assumes a YOLO detection output, `[1, 4+nc, anchors]`, and reads
the tensor as boxes unconditionally. Hand it a classifier or a pose model and it
produces confident nonsense rather than an error, so the verdict computed here
is what stops an unusable model from reaching a running pipeline. These tests
pin each way a model can fail that check.

OpenVINO model objects are faked: only `partial_shape` and `rt_info` are read.
"""

from __future__ import annotations

import pytest

from stream_monitor.pipeline.prefilter_yolo import inspect_ov_model


class _Dim:
    def __init__(self, length: int | None):
        self._length = length

    @property
    def is_dynamic(self) -> bool:
        return self._length is None

    def get_length(self) -> int:
        if self._length is None:
            raise RuntimeError("dynamic dimension has no length")
        return self._length


class _Shape:
    def __init__(self, dims: list[int | None]):
        self._dims = [_Dim(d) for d in dims]

    def __len__(self) -> int:
        return len(self._dims)

    def __getitem__(self, i):
        return self._dims[i]

    def __iter__(self):
        return iter(self._dims)

    @property
    def is_dynamic(self) -> bool:
        return any(d.is_dynamic for d in self._dims)

    def __str__(self) -> str:
        return "[" + ",".join("?" if d.is_dynamic else str(d.get_length())
                              for d in self._dims) + "]"


class _Port:
    def __init__(self, dims):
        self.partial_shape = _Shape(dims)


class _Model:
    """Minimal stand-in for an `openvino.Model`."""

    def __init__(self, in_dims, out_dims, labels: str | None = None):
        self._in = _Port(in_dims)
        self._out = _Port(out_dims)
        self._labels = labels

    def input(self, _i):
        return self._in

    def output(self, _i):
        return self._out

    def get_rt_info(self, _keys):
        if self._labels is None:
            raise RuntimeError("no labels in rt_info")

        class _Str(str):
            def astype(self, _t):
                return self

        return _Str(self._labels)


class TestDetectionVerdict:
    def test_yolo_shape_with_matching_labels(self):
        info = inspect_ov_model(_Model([1, 3, 704, 1280], [1, 84, 18480], "person car"
                                       + " x" * 78))
        assert info.is_detection
        assert info.labels_source == "embedded"
        assert info.input_shape == "[1,3,704,1280]"
        assert info.output_shape == "[1,84,18480]"

    def test_label_count_mismatch_is_not_detection(self):
        """84 channels means 80 classes; a model claiming 2 labels is miswired."""
        info = inspect_ov_model(_Model([1, 3, 640, 640], [1, 84, 8400], "person car"))
        assert not info.is_detection
        assert "80 class channels" in info.detection_error
        assert "2 labels" in info.detection_error

    def test_classification_output_is_not_detection(self):
        info = inspect_ov_model(_Model([1, 3, 224, 224], [1, 1000], "cat dog"))
        assert not info.is_detection
        assert "rank-3 detection output" in info.detection_error

    def test_four_channel_output_is_not_detection(self):
        """4 channels is boxes with zero classes — nothing to filter on."""
        info = inspect_ov_model(_Model([1, 3, 640, 640], [1, 4, 8400], "person"))
        assert not info.is_detection
        assert "more than 4 channels" in info.detection_error

    def test_dynamic_channel_count_is_accepted(self):
        """Nothing contradicts the layout; the per-frame decode copes."""
        info = inspect_ov_model(_Model([1, 3, 640, 640], [1, None, 8400], "person"))
        assert info.is_detection
        assert info.detection_error == ""

    def test_unreadable_shape_is_not_detection(self):
        class _Broken(_Model):
            def output(self, _i):
                raise RuntimeError("no output port")

        info = inspect_ov_model(_Broken([1, 3, 640, 640], [1, 84, 8400], "person"))
        assert not info.is_detection
        assert info.detection_error

    def test_missing_labels_fall_back_to_coco(self):
        """Without embedded labels the count cannot contradict anything."""
        info = inspect_ov_model(_Model([1, 3, 640, 640], [1, 10, 8400], labels=None))
        assert info.labels_source == "fallback_coco"
        assert info.is_detection
        assert len(info.class_names) == 80


class TestReadModelLabelsCompat:
    def test_unreadable_model_reports_unavailable(self, monkeypatch):
        import stream_monitor.pipeline.prefilter_yolo as pf

        monkeypatch.setattr(pf, "inspect_model", lambda p: None)
        names, source = pf.read_model_labels("/does/not/exist.xml")
        assert source == "unavailable"
        assert len(names) == 80  # COCO fallback
