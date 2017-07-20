const del = require('del');
const gulp = require('gulp');
const beautify = require('gulp-beautify');
const debug = require('gulp-debug');
const jsonTransform = require('gulp-json-transform');
const ts = require('gulp-typescript');

gulp.task('default', ['clean', 'copyPackageJson', 'copyTemplates', 'copyLib']);

gulp.task('clean', function () {
  return del(['dist']);
});

gulp.task('copyTemplates', ['clean'], function () {
  return gulp.src('src/**/*.hbs').pipe(gulp.dest('dist'));
});

gulp.task('copyPackageJson', ['clean'], function () {
  return gulp.src('package.json')
    .pipe(jsonTransform((packageJson, file) => {
        delete packageJson.scripts['build'];
        delete packageJson['devDependencies'];

        return packageJson;
      }
    ))
    .pipe(beautify({indent_size: 2}))
    .pipe(gulp.dest('dist'));
});

gulp.task('copyLib', ['clean'], function () {
  return gulp.src(['src/**/*.ts', '!src/lib/util/**/*.ts']).pipe(ts({project: 'tsconfig.json'})).pipe(gulp.dest('dist'));
});
