# videostream-analytics tests

```bash
# from videostream-analytics/
.venv/bin/python -m pytest tests/unit -q                    # unit suite
bash tests/test_setup_vsa.sh                                # setup_vsa.sh contract tests
.venv/bin/python -m pytest tests/integration -m integration # needs MediaMTX, mock webhook, ffmpeg producer
```
