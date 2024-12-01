# Test a release wheel in a fresh conda environment with and without installed
# extensions
set -v
old="${CONDA_DEFAULT_ENV}"
JLAB_TEST_ENV="${CONDA_DEFAULT_ENV}_test"
TEST_DIR="$WORK_DIR/test"

conda create --override-channels --strict-channel-priority -c conda-forge -c anaconda -y -n "$JLAB_TEST_ENV" notebook nodejs twine
conda activate "$JLAB_TEST_ENV"

pip install dist/*.whl


mkdir -p $TEST_DIR
cp examples/notebooks/*.ipynb $TEST_DIR/
pushd $TEST_DIR

python -m jupyterlab.browser_check

jupyter labextension install @jupyterlab/fasta-extension --no-build
jupyter labextension install @jupyterlab/geojson-extension --no-build
jupyter labextension install @jupyterlab/plotly-extension --no-build
jupyter labextension install @jupyter-widgets/jupyterlab-manager --no-build
jupyter labextension install bqplot --no-build
jupyter labextension install jupyter-leaflet --no-build
jupyter lab clean

conda install --override-channels --strict-channel-priority -c conda-forge -c anaconda -y ipywidgets altair matplotlib vega_datasets
jupyter lab build && python -m jupyterlab.browser_check && jupyter lab

conda deactivate
popd
