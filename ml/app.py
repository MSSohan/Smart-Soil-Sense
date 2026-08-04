from flask import Flask, request, jsonify
import joblib
import pandas as pd

app = Flask(__name__)

model = joblib.load(r"ml\crop_model.pkl")
label_encoder = joblib.load(r"ml\label_encoder.pkl")


@app.route("/predict", methods=["POST"])
def predict():

    data = request.json

    # Create DataFrame with EXACT feature names used during training
    features = pd.DataFrame([{
        "Soil_Moisture": data["soil_moisture"],
        "Humidity": data["humidity"],
        "Temperature": data["temperature"],
        "Rainfall": data["rainfall"],
        "pH": data["ph"]
    }])

    prediction = model.predict(features)
    crop = label_encoder.inverse_transform(prediction)

    return jsonify({
        "prediction": crop[0]
    })


if __name__ == "__main__":
    app.run(port=5001)