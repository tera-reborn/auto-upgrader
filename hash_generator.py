#!/usr/bin/env python3
"""
Simple File Hash Generator
Generates hash values for files using various algorithms.
"""

import hashlib
import sys
import os
import argparse
from pathlib import Path

def calculate_hash(file_path, algorithm='sha256', chunk_size=8192):
    """
    Calculate hash for a file using specified algorithm.
    
    Args:
        file_path (str): Path to the file
        algorithm (str): Hash algorithm to use
        chunk_size (int): Size of chunks to read at a time
    
    Returns:
        str: Hex digest of the hash
    """
    try:
        hash_obj = hashlib.new(algorithm)
    except ValueError:
        raise ValueError(f"Unsupported hash algorithm: {algorithm}")
    
    try:
        with open(file_path, 'rb') as file:
            while chunk := file.read(chunk_size):
                hash_obj.update(chunk)
        return hash_obj.hexdigest()
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {file_path}")
    except PermissionError:
        raise PermissionError(f"Permission denied: {file_path}")

def get_available_algorithms():
    """Get list of available hash algorithms."""
    return sorted(hashlib.algorithms_available)

def format_output(file_path, algorithm, hash_value, file_size=None):
    """Format the output string."""
    if file_size is not None:
        return f"{algorithm.upper()}: {hash_value}\nFile: {file_path}\nSize: {file_size:,} bytes"
    else:
        return f"{algorithm.upper()}: {hash_value}\nFile: {file_path}"

def main():
    parser = argparse.ArgumentParser(
        description='Generate hash values for files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python file_hasher.py myfile.txt
  python file_hasher.py myfile.txt --algorithm md5
  python file_hasher.py myfile.txt --algorithm sha1 --size
  python file_hasher.py --list-algorithms
        '''
    )
    
    parser.add_argument('file', nargs='?', help='Path to the file to hash')
    parser.add_argument('-a', '--algorithm', default='sha256',
                       help='Hash algorithm to use (default: sha256)')
    parser.add_argument('-s', '--size', action='store_true',
                       help='Show file size in output')
    parser.add_argument('-l', '--list-algorithms', action='store_true',
                       help='List available hash algorithms')
    parser.add_argument('-q', '--quiet', action='store_true',
                       help='Output only the hash value')
    
    args = parser.parse_args()
    
    # List available algorithms
    if args.list_algorithms:
        print("Available hash algorithms:")
        for algo in get_available_algorithms():
            print(f"  {algo}")
        return
    
    # Check if file argument is provided
    if not args.file:
        parser.error("File path is required (use --help for usage)")
    
    file_path = Path(args.file)
    
    # Check if file exists
    if not file_path.exists():
        print(f"Error: File '{file_path}' does not exist.", file=sys.stderr)
        sys.exit(1)
    
    if not file_path.is_file():
        print(f"Error: '{file_path}' is not a file.", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Calculate hash
        hash_value = calculate_hash(file_path, args.algorithm.lower())
        
        if args.quiet:
            print(hash_value)
        else:
            file_size = file_path.stat().st_size if args.size else None
            output = format_output(file_path, args.algorithm, hash_value, file_size)
            print(output)
            
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        print(f"Use --list-algorithms to see available options.", file=sys.stderr)
        sys.exit(1)
    except (FileNotFoundError, PermissionError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()