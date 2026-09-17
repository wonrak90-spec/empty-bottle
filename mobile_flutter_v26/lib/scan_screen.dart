import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import 'input_image_converter.dart';
import 'label_model.dart';
import 'label_parser.dart';
import 'stability_tracker.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  CameraController? _controller;
  CameraDescription? _camera;
  final TextRecognizer _recognizer =
      TextRecognizer(script: TextRecognitionScript.korean);

  final StabilityTracker _tracker = StabilityTracker(requiredHits: 3);
  final Map<String, String> _stable = {};

  LabelMode _mode = LabelMode.wms;
  bool _busy = false;
  bool _initialized = false;
  int _lastAnalyzeMs = 0;
  int _lastOcrMs = 0;
  String _status = '카메라 준비 중…';

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw Exception('사용 가능한 카메라가 없습니다.');

      _camera = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );

      _controller = CameraController(
        _camera!,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup:
            Platform.isAndroid ? ImageFormatGroup.nv21 : ImageFormatGroup.bgra8888,
      );

      await _controller!.initialize();
      await _controller!.startImageStream(_analyzeFrame);

      if (!mounted) return;
      setState(() {
        _initialized = true;
        _status = 'WMS 라벨을 사각형 안에 맞추세요.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = '카메라 시작 실패: $e');
    }
  }

  Future<void> _analyzeFrame(CameraImage image) async {
    if (_busy || _controller == null || _camera == null) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastAnalyzeMs < 300) return;
    _lastAnalyzeMs = now;

    final inputImage = inputImageFromCameraImage(
      image: image,
      camera: _camera!,
      deviceOrientation: _controller!.value.deviceOrientation,
    );
    if (inputImage == null) return;

    _busy = true;
    final sw = Stopwatch()..start();

    try {
      final result = await _recognizer.processImage(inputImage);
      _consumeText(result.text);
    } catch (e) {
      if (mounted) setState(() => _status = 'OCR 오류: $e');
    } finally {
      sw.stop();
      _lastOcrMs = sw.elapsedMilliseconds;
      _busy = false;
      if (mounted) setState(() {});
    }
  }

  void _consumeText(String raw) {
    if (raw.trim().isEmpty) return;
    final parsed =
        _mode == LabelMode.wms ? LabelParser.parseWms(raw) : LabelParser.parseVendor(raw);

    if (_mode == LabelMode.wms) {
      _accept('입고번호', parsed.inboundNo);
      _accept('품명', parsed.product);
      _accept('품목코드', parsed.itemCode);
      _accept('수량', parsed.qty);
      _accept('공급업체', parsed.supplier);
      _accept('입고일자', parsed.inboundDate);
      _accept('사용기한', parsed.expiryDate);
      _accept('용기번호', parsed.containerNo);
    } else {
      _accept('품명', parsed.product);
      _accept('수량', parsed.qty);
      _accept('Lot', parsed.lotNo);
      _accept('Pallet No', parsed.palletNo);
      _accept('생산일자', parsed.prodDate);
      _accept('생산시간', parsed.prodTime);
      _accept('라인', parsed.line);
    }

    final required = _requiredFields;
    final done = required.where(_stable.containsKey).length;

    if (mounted) {
      setState(() {
        _status = done == required.length
            ? '필수 항목 인식 완료 ✓'
            : '필수 항목 $done/${required.length} 안정 인식';
      });
    }
  }

  List<String> get _requiredFields => _mode == LabelMode.wms
      ? ['입고번호', '품명', '품목코드', '수량', '용기번호']
      : ['품명', '수량', 'Lot'];

  void _accept(String key, String? candidate) {
    if (_stable.containsKey(key)) return;
    final value = _tracker.stable(key, candidate);
    if (value != null) _stable[key] = value;
  }

  void _switchMode(LabelMode mode) {
    _mode = mode;
    _tracker.reset();
    _stable.clear();
    setState(() {
      _status = mode == LabelMode.wms
          ? 'WMS 라벨을 사각형 안에 맞추세요. 바코드는 읽지 않습니다.'
          : '업체 라벨을 사각형 안에 맞추세요.';
    });
  }

  void _reset() {
    _tracker.reset();
    _stable.clear();
    setState(() => _status = '현재 라벨을 다시 인식합니다.');
  }

  @override
  void dispose() {
    _controller?.stopImageStream();
    _controller?.dispose();
    _recognizer.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;

    return Scaffold(
      appBar: AppBar(
        title: const Text('공병 입고 확인 · V26'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              flex: 6,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (_initialized && controller != null)
                    CameraPreview(controller)
                  else
                    const Center(child: CircularProgressIndicator()),
                  Center(
                    child: Container(
                      margin: const EdgeInsets.all(24),
                      height: 230,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white, width: 3),
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                  ),
                  Positioned(
                    right: 12,
                    top: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.65),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'OCR ${_lastOcrMs}ms',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: SegmentedButton<LabelMode>(
                segments: const [
                  ButtonSegment(
                    value: LabelMode.wms,
                    label: Text('WMS 라벨'),
                  ),
                  ButtonSegment(
                    value: LabelMode.vendor,
                    label: Text('업체 라벨'),
                  ),
                ],
                selected: {_mode},
                onSelectionChanged: (v) => _switchMode(v.first),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(_status),
              ),
            ),
            Expanded(
              flex: 3,
              child: Container(
                width: double.infinity,
                color: Colors.white,
                padding: const EdgeInsets.all(14),
                child: _stable.isEmpty
                    ? const Text('텍스트 탐색 중…')
                    : ListView(
                        children: _stable.entries
                            .map((e) => Padding(
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 3),
                                  child: Text('✓ ${e.key}: ${e.value}'),
                                ))
                            .toList(),
                      ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton.tonal(
                onPressed: _reset,
                child: const Text('현재 라벨 다시 인식'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
