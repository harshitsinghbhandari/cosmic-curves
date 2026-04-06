"""
Storage Module

This module handles persistent storage of experiment runs in a JSON file.
It uses a threading lock to ensure thread-safe concurrent access.
"""

import os
import json
import threading
from typing import Dict, Any, Optional, List

# Define storage paths
current_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(current_dir, "data")
RUNS_FILE = os.path.join(DATA_DIR, "runs.json")

# Thread lock to prevent concurrent write corruption
runs_lock = threading.Lock()

def init_storage():
    """
    Initialize storage directories and files.
    Creates the data directory and leads an empty runs.json if it doesn't exist.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(RUNS_FILE):
        with open(RUNS_FILE, 'w') as f:
            json.dump([], f)

def get_all_runs() -> List[Dict[str, Any]]:
    """
    Retrieve all stored runs from the runs.json file.

    Returns:
        List[dict]: A list of all historical run objects.
    """
    with runs_lock:
        if not os.path.exists(RUNS_FILE):
            return []
        try:
            with open(RUNS_FILE, 'r') as f:
                return json.load(f)
        except json.JSONDecodeError:
            return []

def append_run(run_data: Dict[str, Any]):
    """
    Append a new run to the persistent store.

    Args:
        run_data: Dictionary containing the run statistics and coordinates.
    """
    with runs_lock:
        runs = []
        if os.path.exists(RUNS_FILE):
            try:
                with open(RUNS_FILE, 'r') as f:
                    runs = json.load(f)
            except json.JSONDecodeError:
                runs = []
        
        runs.append(run_data)
        
        with open(RUNS_FILE, 'w') as f:
            json.dump(runs, f, indent=2)

def get_run_by_id(run_id: str) -> Optional[Dict[str, Any]]:
    """
    Find a specific run by its unique ID.

    Args:
        run_id: The UUID or string ID of the run.

    Returns:
        Optional[dict]: The run object if found, else None.
    """
    runs = get_all_runs()
    for run in runs:
        if run.get("run_id") == run_id:
            return run
    return None
