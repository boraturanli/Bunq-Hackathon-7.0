def pytest_configure(config):
    config.addinivalue_line("markers", "unit: fast tests with mocked BunqLib — no sandbox needed")
    config.addinivalue_line("markers", "integration: tests that require a live bunq sandbox")
