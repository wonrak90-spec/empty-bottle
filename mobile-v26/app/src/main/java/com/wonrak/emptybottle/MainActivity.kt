package com.wonrak.emptybottle

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.wonrak.emptybottle.databinding.ActivityMainBinding
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val tracker = StabilityTracker(3)
    private val stable = linkedMapOf<String, String>()
    private var mode = Mode.WMS
    private var lastAnalyzeAt = 0L
    private var lastFrameStart = 0L

    private enum class Mode { WMS, VENDOR }

    private val recognizer by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else binding.statusText.text = "카메라 권한이 필요합니다."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnWms.setOnClickListener { switchMode(Mode.WMS) }
        binding.btnVendor.setOnClickListener { switchMode(Mode.VENDOR) }
        binding.btnReset.setOnClickListener { resetCurrent() }
        switchMode(Mode.WMS)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else permission.launch(Manifest.permission.CAMERA)
    }

    private fun switchMode(next: Mode) {
        mode = next
        resetCurrent()
        binding.statusText.text = if (next == Mode.WMS)
            "WMS 라벨을 사각형 안에 맞추세요. 바코드는 읽지 않습니다."
        else "업체 라벨을 사각형 안에 맞추세요."
        binding.btnWms.isEnabled = next != Mode.WMS
        binding.btnVendor.isEnabled = next != Mode.VENDOR
    }

    private fun resetCurrent() {
        tracker.reset()
        stable.clear()
        binding.resultText.text = "인식 대기 중"
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setTargetResolution(android.util.Size(1280, 720))
                .build()

            analysis.setAnalyzer(cameraExecutor) { proxy ->
                val now = SystemClock.elapsedRealtime()
                if (busy.get() || now - lastAnalyzeAt < 300L) {
                    proxy.close()
                    return@setAnalyzer
                }
                lastAnalyzeAt = now
                val media = proxy.image ?: run {
                    proxy.close()
                    return@setAnalyzer
                }
                busy.set(true)
                lastFrameStart = now
                val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
                recognizer.process(image)
                    .addOnSuccessListener { result -> handleText(result.text) }
                    .addOnFailureListener { e ->
                        runOnUiThread { binding.statusText.text = "OCR 오류: ${e.message}" }
                    }
                    .addOnCompleteListener {
                        val ms = SystemClock.elapsedRealtime() - lastFrameStart
                        runOnUiThread { binding.fpsText.text = "OCR ${ms}ms" }
                        busy.set(false)
                        proxy.close()
                    }
            }

            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun handleText(raw: String) {
        if (raw.isBlank()) return
        val p = if (mode == Mode.WMS) LabelParser.parseWms(raw) else LabelParser.parseVendor(raw)
        if (mode == Mode.WMS) {
            accept("입고번호", p.inboundNo)
            accept("품명", p.product)
            accept("품목코드", p.itemCode)
            accept("수량", p.qty)
            accept("공급업체", p.supplier)
            accept("입고일자", p.inboundDate)
            accept("사용기한", p.expiryDate)
            accept("용기번호", p.containerNo)
        } else {
            accept("품명", p.product)
            accept("수량", p.qty)
            accept("Lot", p.lotNo)
            accept("Pallet No", p.palletNo)
            accept("생산일자", p.prodDate)
            accept("생산시간", p.prodTime)
            accept("라인", p.line)
        }
        render()
    }

    private fun accept(key: String, candidate: String?) {
        if (stable.containsKey(key)) return
        tracker.stable(key, candidate)?.let { stable[key] = it }
    }

    private fun render() = runOnUiThread {
        val required = if (mode == Mode.WMS)
            listOf("입고번호", "품명", "품목코드", "수량", "용기번호")
        else listOf("품명", "수량", "Lot")

        val lines = stable.entries.joinToString("\n") { "✓ ${it.key}: ${it.value}" }
        binding.resultText.text = if (lines.isBlank()) "텍스트 탐색 중…" else lines
        val done = required.count { stable.containsKey(it) }
        binding.statusText.text = if (done == required.size)
            "필수 항목 인식 완료 ✓"
        else "필수 항목 ${done}/${required.size} 안정 인식"
    }

    override fun onDestroy() {
        super.onDestroy()
        recognizer.close()
        cameraExecutor.shutdown()
    }
}
