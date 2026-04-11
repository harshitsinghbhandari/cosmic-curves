from ollama import chat
# from pathlib import Path

# Pass in the path to the image
path = '../tests/output_frames/test_frame_1506.jpg'

# You can also pass in base64 encoded image data
# img = base64.b64encode(Path(path).read_bytes()).decode()
# or the raw bytes
# img = Path(path).read_bytes()

response = chat(
  model='gemma4:31b-cloud',
  messages=[
    {
      'role': 'user',
      'content': 'You can see there is a image with 2 balls. the big ball is very easily detectable via hough circles (as suggested by you), but the small ball is not detectable. What are the things I can try to detect the smaller ball.',
      'images': [path],
    }
  ],
)

print(response.message.content)