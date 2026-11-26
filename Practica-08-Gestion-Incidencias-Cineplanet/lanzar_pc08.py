import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "exe"))
from pc08.principal import main  # noqa: E402
sys.exit(main())
