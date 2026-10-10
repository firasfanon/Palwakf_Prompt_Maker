const os = require('os'); const real = os.uptime; os.uptime = () => real() - 300; // simulates a machine whose computed boot time drifted by 300 s
