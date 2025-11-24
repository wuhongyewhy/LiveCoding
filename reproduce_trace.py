import sys
import io

# Force UTF-8
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

try:
    from space_tracer.main import TraceRunner
    
    code = """a = 4
for i in range(a):
    if i%2==0:
        continue
    a += i

print(a)
"""
    runner = TraceRunner()
    report = runner.trace_code(code)
    print("--- REPORT START ---")
    print(report)
    print("--- REPORT END ---")
except Exception as e:
    print(e)
